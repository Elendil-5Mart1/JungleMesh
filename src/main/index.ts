//* Entry point of the Electron main process
import { app, desktopCapturer, dialog, ipcMain, session, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { AppSettings, Avatar, ChannelKind, ChatMessage, CoreState, ScreenSource, SoundKind } from '../shared/types'
import { P2PCore } from './p2p/core'
import { cleanFileName } from './p2p/journal'
import { createNotifier, type ConvInfo } from './notifier'
import { findInviteCode, SCHEME } from './inviteLink'
import { createSettings } from './settings'
import { createTray } from './tray'
import { startUpdater } from './updater'
import { setupSpellcheck } from './textMenu'
import {
  MIN_PASSPHRASE,
  IDENTITY_FILES,
  applyRestore,
  collectBackup,
  decryptBackup,
  encryptBackup,
  stageRestore
} from './backup'
import { setupI18n, t } from '../shared/i18n'
import { loadSession, saveSession } from './windowState'
import {
  broadcast,
  getWindow,
  allWindows,
  getWindowId,
  openWindow,
  setWindowMaterial,
  visibleWindowIds,
  watchVisibleWindows
} from './windows'

//& Profiles: allows running several instances on the same PC for testing (Alice / Bob…)
// `npm run dev:bob` → --profile=bob → data in a separate folder
const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1]
if (profile) app.setPath('userData', join(app.getPath('userData'), `profile-${profile}`))

//& Wipe ("new identity" / "erase everything"): files cannot be deleted while the
// P2P core is using them. So the app relaunches with --reset=…, and we delete them here, before anything starts.
const reset = process.argv.find((a) => a.startsWith('--reset='))?.split('=')[1]
if (reset === 'identity' || reset === 'all') {
  const dir = app.getPath('userData')
  // identity: key, contacts, rooms, caches. We keep the profile (name/avatar), settings and window positions.
  const identity = IDENTITY_FILES
  const keep = reset === 'identity' ? new Set(['profile.json', 'settings.json', 'windowState.json']) : null
  const ours = new Set([...identity, 'profile.json', 'settings.json', 'windowState.json'])
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!ours.has(name) || keep?.has(name)) continue // never anything other than OUR files (neither test profiles nor Chromium)
      try {
        rmSync(join(dir, name), { recursive: true, force: true })
      } catch (err) {
        console.error('reset: could not remove', name, err)
      }
    }
  }
}

//& Import of a backup: the swap happens here too, before the P2P core opens anything
applyRestore(app.getPath('userData'))

// A single instance per profile (otherwise two P2P cores with the same identity)
// (app.exit and not app.quit: quit is asynchronous and would let the code carry on)
if (!app.requestSingleInstanceLock()) app.exit(0)

// Windows groups notifications by "AppUserModelId": without it, no toast.
// In dev we reuse the path of electron.exe (the only id Windows already knows).
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'org.junglemesh.app' : process.execPath)

const core = new P2PCore(app.getPath('userData'))

//& Invite link (junglemesh://add/<code>)
// The received code waits here until the home window displays it: the user always confirms themselves.
let pendingInvite: string | null = null

const receiveLink = (args: string[]): boolean => {
  const code = findInviteCode(args)
  if (!code) return false
  pendingInvite = code
  openHome()
  broadcast('invite:link', code)
  return true
}

//& Windows
// Every window has its own taskbar button, labelled with its title (friend, room, settings)
const openHome = (): void => {
  openWindow({
    id: 'home',
    route: '/home',
    width: 340,
    height: 600,
    title: profile ? `JungleMesh (${profile})` : 'JungleMesh'
  })
}

const friendName = (key: string): string => core.friendName(key) ?? t('chat.friend')

const openChat = (key: string): void => {
  openWindow({
    id: `chat:${key}`,
    route: `/chat/${key}`,
    width: 520,
    height: 640,
    title: friendName(key)
  })
}

const openRoom = (key: string): void => {
  const title = core.roomName(key) ?? t('room.fallbackName')
  openWindow({ id: `room:${key}`, route: `/room/${key}`, width: 980, height: 640, title })
}

// Incoming call: small popup centered on the screen, Join / Decline
const openIncoming = (key: string): void => {
  if (getWindow(`incoming:${key}`)) return
  const win = openWindow({ id: `incoming:${key}`, route: `/incoming/${key}`, width: 320, height: 280, title: t('notif.callTitle'), popup: true })
  // Closed with the ✕ = Decline. Not when it closes because the call was answered or is over.
  win.on('closed', () => {
    if (!handled.delete(key)) declineCall(key)
  })
}
const handled = new Set<string>() // popups closed by the app itself (answered, hung up, declined)
const closeIncoming = (key: string): void => {
  const win = getWindow(`incoming:${key}`)
  if (!win) return
  handled.add(key)
  win.close()
}
// Decline: no more ringing here, and the caller is told (their call ends)
const declineCall = (key: string): void => {
  notifier.decline(key)
  core.declineCall(key).catch((err) => console.error('call: decline failed', err))
}

// "Join" in the popup: the friend's window opens and joins the call by itself.
// Window already loaded: we tell it right away; otherwise it asks once loaded (call:takeAutoJoin).
const autoJoin = new Set<string>()
const acceptCall = (key: string): void => {
  closeIncoming(key)
  const existing = getWindow(`chat:${key}`)
  openChat(key)
  if (existing && !existing.webContents.isLoading()) existing.webContents.send('call:autojoin')
  else autoJoin.add(key)
}

// Settings: a single window
const openSettings = (): void => {
  openWindow({ id: 'settings', route: '/settings', width: 760, height: 560, title: t('settings.title') })
}

// Toggle (click in the home window): closed or hidden → show it; on screen → close it
const toggleWindow = (id: string, open: () => void): void => {
  const win = getWindow(id)
  if (win?.isVisible()) win.close()
  else open()
}

//& Unread and notifications
// convId = key of a friend (DM) or of a room: we describe the conversation to the notifier
// Last state sent to the windows: enough for names, and avoids rebuilding the whole state per received message
// (rebuilt only if it does not know the room or the author yet: a member who just joined)
let lastState: CoreState | null = null
const describe = (convId: string, msg: ChatMessage): ConvInfo => {
  if (!core.isRoom(convId)) return { windowId: `chat:${convId}`, title: friendName(convId), open: () => openChat(convId) }
  const known = (s: CoreState | null) => s?.rooms.find((r) => r.key === convId && r.members.some((m) => m.key === msg.from))
  const room = known(lastState) ?? core.getState().rooms.find((r) => r.key === convId)
  if (!room) return { windowId: `room:${convId}`, title: core.roomName(convId) ?? '', open: () => openRoom(convId) }
  const author = room.members.find((m) => m.key === msg.from)?.name ?? '?'
  const channel = room.channels.find((c) => c.id === (msg.channel ?? 'general'))?.name ?? 'general'
  return { windowId: `room:${convId}`, title: `${author} · ${room.name} #${channel}`, open: () => openRoom(convId) }
}

let tray: ReturnType<typeof createTray> | null = null // created once the app is ready

// App settings: every change is broadcast to all windows
// Settings that apply to the windows themselves (screen capture, local IP leak in WebRTC)
const hardenWindow = (win: BrowserWindow): void => {
  win.setContentProtection(settings.get().contentProtection)
  // Only publish the default network interface (not VPNs / virtual machines), with its local address:
  // without it, two devices on the same network can only reach each other through the router's public IP,
  // which many routers refuse (no "hairpinning") → calls stuck on "connecting". The local IP (192.168…) is
  // useless from the Internet. Relay mode stays strict: `iceTransportPolicy: 'relay'` ignores these addresses.
  win.webContents.setWebRTCIPHandlingPolicy('default_public_and_private_interfaces')
}
const applyWindowSettings = (): void => {
  allWindows().forEach(hardenWindow)
  // Blur behind the windows: only useful (and only applied) when the backgrounds are translucent
  const { windowOpacity, windowMaterial } = settings.get()
  setWindowMaterial(windowOpacity < 100 ? windowMaterial : 'none')
}

const settings = createSettings((s: AppSettings) => {
  broadcast('settings:changed', s)
  applyWindowSettings()
})
setWindowMaterial(settings.get().windowOpacity < 100 ? settings.get().windowMaterial : 'none')
app.on('browser-window-created', (_e, win) => hardenWindow(win))

const notifier = createNotifier({
  myKey: () => core.getState().me.publicKey,
  describe,
  openHome,
  openIncoming,
  closeIncoming,
  settings: settings.get,
  onChange: (unread) => {
    broadcast('unread:changed', unread)
    tray?.refresh()
  }
})

//& Security
// By default Electron grants ALL web permissions (camera, geolocation, notifications…): we only allow the microphone
// and camera, writing to the clipboard ("copy" buttons) and full screen (⛶ button of the call stage).
// Reading the clipboard stays refused.
// The embedded players (YouTube, SoundCloud… in an iframe) only get full screen: microphone, camera and
// clipboard stay for our own pages.
const GRANTABLE = new Set(['media', 'clipboard-sanitized-write', 'fullscreen'])
const grantable = (permission: string, url: string): boolean =>
  GRANTABLE.has(permission) && (permission === 'fullscreen' || fromOurUrl(url))
const lockPermissions = (): void => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => callback(grantable(permission, details.requestingUrl)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => grantable(permission, origin))
  // YouTube's embedded player refuses to play (error 153) without a Referer saying which site embeds it,
  // and our pages are file:// (no Referer at all). We add one, only to the requests of the YouTube player.
  // See the tutorial in manual.md.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (details, callback) =>
    callback({ requestHeaders: { ...details.requestHeaders, Referer: EMBED_REFERER } })
  )
  // Screen sharing: Chromium asks here WHAT to capture when a page calls getDisplayMedia.
  // We only answer with the source the user just picked in our own picker (screen:choose), once:
  // a page cannot capture the screen on its own, without that click.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const choice = screenChoice
    screenChoice = null
    const fresh = choice && Date.now() - choice.at < 10_000
    const ours = request.frame && fromOurUrl(request.frame.url)
    const sources = fresh && ours ? await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }) : []
    const source = sources.find((s) => s.id === choice?.id)
    // No video in the answer = request refused (the page gets a NotAllowedError)
    if (!source) return callback({})
    // 'loopback' = sound of the whole PC (Windows only); the page then removes its own voices (restrictOwnAudio)
    callback({ video: source, audio: choice!.audio && process.platform === 'win32' ? 'loopback' : undefined })
  })
}

// Site given to YouTube as the one embedding its player: the project's page (we do not own another domain)
const EMBED_REFERER = 'https://github.com/Elendil-5Mart1/JungleMesh'

// Source picked in the picker, waiting for the page's getDisplayMedia (see above)
let screenChoice: { id: string; audio: boolean; at: number } | null = null

// IPC messages must only come from our own pages (local file, or Vite server in dev)
const fromOurUrl = (url: string): boolean => {
  const dev = process.env.ELECTRON_RENDERER_URL
  return url.startsWith('file://') || (!!dev && url.startsWith(dev))
}
const fromOurPages = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => fromOurUrl(e.senderFrame?.url ?? '')
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, (e, ...args) => {
    if (!fromOurPages(e)) throw new Error('Forbidden')
    return listener(e, ...args)
  })
const on = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, listener) => on(channel, (e, ...args) => (fromOurPages(e) ? listener(e, ...args) : undefined))

// A public key = 64 hexadecimal characters; anything else is rejected before reaching the core
const asKey = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid key')
  return value
}

//& IPC bridge: the windows ask, the core answers
ipcMain.handle('core:getState', () => core.getState())
ipcMain.handle('core:setName', (_e, name: string) => core.setName(name))
ipcMain.handle('core:setAvatar', (_e, avatar: Avatar) => core.setAvatar(avatar))
ipcMain.handle('friends:add', (_e, code: string, nickname: string) => core.addFriend(code, nickname))
ipcMain.handle('friends:accept', (_e, key: string) => core.acceptRequest(asKey(key)))
ipcMain.handle('friends:decline', (_e, key: string) => core.declineRequest(asKey(key)))
ipcMain.handle('rooms:create', (_e, name: string) => core.createRoom(name))
ipcMain.handle('rooms:setAvatar', (_e, room: string, avatar: Avatar) => core.setRoomAvatar(asKey(room), avatar))
ipcMain.handle('rooms:createChannel', (_e, room: string, name: string, kind: ChannelKind) =>
  core.createChannel(asKey(room), name, kind === 'voice' ? 'voice' : 'text')
)
ipcMain.handle('rooms:rename', (_e, room: string, name: string) => core.renameRoom(asKey(room), name))
ipcMain.handle('rooms:renameChannel', (_e, room: string, id: string, name: string) =>
  core.renameChannel(asKey(room), String(id), name)
)
ipcMain.handle('rooms:deleteChannel', (_e, room: string, id: string) => core.deleteChannel(asKey(room), String(id)))
ipcMain.handle('rooms:kick', (_e, room: string, member: string) => core.kickFromRoom(asKey(room), asKey(member)))
ipcMain.handle('rooms:leave', (_e, room: string) => core.leaveRoom(asKey(room)))
ipcMain.handle('rooms:delete', (_e, room: string) => core.deleteRoom(asKey(room)))
ipcMain.handle('friends:remove', (_e, key: string) => core.removeFriend(asKey(key)))
ipcMain.handle('friends:unblock', (_e, key: string) => core.unblock(asKey(key)))
ipcMain.handle('rooms:invite', (_e, room: string, friend: string) => core.inviteToRoom(asKey(room), asKey(friend)))
ipcMain.handle('rooms:accept', (_e, room: string) => core.acceptRoomInvite(asKey(room)))
ipcMain.handle('rooms:decline', (_e, room: string) => core.declineRoomInvite(asKey(room)))
ipcMain.handle('chat:history', (_e, convId: string) => core.getHistory(asKey(convId)))
ipcMain.handle('chat:send', (_e, convId: string, text: string, channel?: string) =>
  core.send(asKey(convId), text, channel)
)
//& Files and images. The main process does the disk work: the page never sees a path.
const MAX_FILE_SIZE = 25 * 1024 * 1024
// Attachment staged in the input (picked, pasted or dropped), sent with the optional text of the message
ipcMain.handle('files:sendBytes', (_e, convId: string, name: string, bytes: unknown, channel?: string, text?: string) => {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_SIZE) throw new Error(t('err.fileTooBig', { max: MAX_FILE_SIZE / 1024 / 1024 }))
  return core.sendFile(asKey(convId), String(name), Buffer.from(bytes), channel, typeof text === 'string' ? text : '')
})
ipcMain.handle('chat:delete', (_e, convId: string, id: string) => core.deleteMessage(asKey(convId), String(id).slice(0, 64)))
core.on('message-deleted', (convId, id, author) => broadcast('chat:deleted', convId, id, author))
ipcMain.handle('chat:edit', (_e, convId: string, id: string, text: string) =>
  core.editMessage(asKey(convId), String(id).slice(0, 64), String(text))
)
ipcMain.handle('chat:react', (_e, convId: string, id: string, to: string, emoji: string, on: boolean) =>
  core.react(asKey(convId), String(id).slice(0, 64), asKey(to), String(emoji), on === true)
)
core.on('message-annotated', (convId, annotation) => broadcast('chat:annotated', convId, annotation))
ipcMain.handle('files:image', (_e, coreKey: string) => core.imageDataUrl(asKey(coreKey)))
// "Download": the user chooses where to save; the file is never opened by the app
// The transfer only starts AFTER the user accepted and chose the destination; progress goes back to the windows.
ipcMain.handle('files:save', async (e, coreKey: string, name: string) => {
  const key = asKey(coreKey)
  const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
  const { canceled, filePath } = await dialog.showSaveDialog(parent!, { defaultPath: cleanFileName(name) })
  if (canceled || !filePath) return false
  await writeFile(filePath, await core.readFile(key))
  void core.releaseFile(key) // the user's copy is the one that counts: we free the app's own storage
  return true
})
// Audio player: the bytes go to the window (a Blob there), then the app's copy is freed like after a download
ipcMain.handle('files:audio', async (_e, coreKey: string) => {
  const key = asKey(coreKey)
  const audio = await core.audioBytes(key)
  void core.releaseFile(key)
  return audio
})
ipcMain.handle('rooms:setImageTtl', (_e, room: string, hours: number | null) => core.setRoomImageTtl(asKey(room), hours))
core.on('file-progress', (key, done, total) => broadcast('files:progress', key, done, total))

// Voice channels: if the window that is calling closes, we leave the channel (otherwise we stay there as a "ghost")
ipcMain.handle('voice:join', (e, room: string, chan: string) => {
  core.voiceJoin(asKey(room), String(chan))
  e.sender.once('destroyed', () => {
    const state = core.getState()
    const spot = state.rooms.find((r) => r.key === room)?.voice[chan] ?? state.friends.find((f) => f.callId === room)?.call
    if (spot?.includes(state.me.publicKey)) core.voiceLeave()
  })
})
ipcMain.handle('voice:leave', () => core.voiceLeave())
ipcMain.handle('voice:signal', (_e, to: string, room: string, chan: string, data: unknown) =>
  core.voiceSignal(to, room, chan, data)
)
// Screen sharing: thumbnails for the picker, then the chosen source (used by setDisplayMediaRequestHandler)
ipcMain.handle('screen:sources', async (): Promise<ScreenSource[]> => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : ''
  }))
})
ipcMain.handle('screen:choose', (_e, id: string, audio: boolean) => {
  screenChoice = { id: String(id), audio: audio === true, at: Date.now() }
})
ipcMain.handle('invite:pending', () => pendingInvite)
ipcMain.handle('invite:clear', () => {
  pendingInvite = null
})
ipcMain.handle('unread:get', () => notifier.getUnread())
// Right click › Mark as read in the home window, without opening the conversation
ipcMain.handle('unread:markRead', (_e, key: string) => notifier.markRead(asKey(key)))
ipcMain.handle('settings:get', () => settings.get())
ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
  settings.update(patch)
  core.setStealth(settings.get().stealth)
  core.setImageTtl(settings.get().imageTtlHours)
  // Muting a conversation clears its unread count (otherwise the badge would stay lit)
  for (const key of settings.get().muted) notifier.markRead(key)
  notifier.onState(core.getState(), true) // ringtone turned off / friend muted while ringing: stop it
})

//& Incoming call popup
ipcMain.handle('call:accept', (_e, key: unknown) => acceptCall(asKey(key)))
ipcMain.handle('call:decline', (_e, key: unknown) => declineCall(asKey(key)))
ipcMain.handle('call:takeAutoJoin', (_e, key: unknown) => autoJoin.delete(asKey(key)))

//& Custom sounds: copied into the profile (the original file can move or disappear), max 5 MB
const SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm']
const soundPath = (kind: SoundKind): string => join(app.getPath('userData'), 'sounds', kind)
const asSoundKind = (kind: unknown): SoundKind => {
  if (kind !== 'notif' && kind !== 'ring') throw new Error('Invalid sound')
  return kind
}
ipcMain.handle('sound:pick', async (e, kind: unknown) => {
  const which = asSoundKind(kind)
  const win = BrowserWindow.fromWebContents(e.sender)
  const options = { properties: ['openFile' as const], filters: [{ name: t('settings.soundFiles'), extensions: SOUND_EXTENSIONS }] }
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (canceled || !filePaths[0]) return null
  if (statSync(filePaths[0]).size > 5_000_000) throw new Error(t('settings.soundTooBig'))
  mkdirSync(join(app.getPath('userData'), 'sounds'), { recursive: true })
  copyFileSync(filePaths[0], soundPath(which))
  const name = basename(filePaths[0])
  settings.setSoundFile(which, name)
  return name
})
ipcMain.handle('sound:reset', (_e, kind: unknown) => {
  const which = asSoundKind(kind)
  rmSync(soundPath(which), { force: true })
  settings.setSoundFile(which, '')
})
ipcMain.handle('sound:get', (_e, kind: unknown) => {
  const which = asSoundKind(kind)
  const name = which === 'notif' ? settings.get().notifSoundFile : settings.get().ringtoneFile
  if (!name || !existsSync(soundPath(which))) return null
  return new Uint8Array(readFileSync(soundPath(which)))
})
ipcMain.handle('window:openSettings', () => openSettings())
ipcMain.handle('data:reset', async (_e, mode: unknown) => {
  if (mode !== 'identity' && mode !== 'all') return
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [t('privacy.resetConfirm'), t('common.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t(mode === 'identity' ? 'privacy.newIdentityAsk' : 'privacy.eraseAllAsk'),
    detail: t('privacy.resetDetail')
  })
  if (response !== 0) return
  await core.stop()
  app.relaunch({ args: [...process.argv.slice(1).filter((a) => !a.startsWith('--reset=')), `--reset=${mode}`] })
  app.exit(0)
})

//& Buttons and handles of the title bar drawn by the app (frameless windows)
// Resizing: at the start we remember the initial size, then the renderer sends the mouse movement
// from that point (in screen pixels) and we recompute the window.
const senderWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(e.sender)
//& Identity backup (encrypted file, see backup.ts)
const BACKUP_FILTER = [{ name: 'JungleMesh backup', extensions: ['jmbackup'] }]
const checkPassphrase = (p: unknown): string => {
  if (typeof p !== 'string' || p.length < MIN_PASSPHRASE) throw new Error(t('backup.tooShort', { min: MIN_PASSPHRASE }))
  return p
}
ipcMain.handle('backup:export', async (e, passphrase: unknown) => {
  const pass = checkPassphrase(passphrase)
  const win = senderWindow(e)
  const options = { defaultPath: 'junglemesh.jmbackup', filters: BACKUP_FILTER }
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return false
  writeFileSync(filePath, encryptBackup(collectBackup(app.getPath('userData'), core.getPrimaryKey()), pass))
  return true
})
ipcMain.handle('backup:import', async (e, passphrase: unknown) => {
  const pass = checkPassphrase(passphrase)
  const win = senderWindow(e)
  const options = { properties: ['openFile' as const], filters: BACKUP_FILTER }
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (canceled || !filePaths[0]) return false
  if (statSync(filePaths[0]).size > 20_000_000) throw new Error(t('backup.invalidFile'))
  const data = decryptBackup(readFileSync(filePaths[0], 'utf8'), pass) // wrong passphrase or bad file: throws before anything changes
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [t('backup.importConfirm'), t('common.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('backup.importAsk'),
    detail: t('backup.importDetail')
  })
  if (response !== 0) return false
  stageRestore(app.getPath('userData'), data)
  await core.stop()
  app.relaunch()
  app.exit(0)
  return true
})

ipcMain.on('win:minimize', (e) => senderWindow(e)?.minimize())
ipcMain.on('win:close', (e) => senderWindow(e)?.close())
let resizeFrom: Electron.Rectangle | null = null
ipcMain.on('win:resizeStart', (e) => {
  resizeFrom = senderWindow(e)?.getBounds() ?? null
})
ipcMain.on('win:resize', (e, edge: string, dx: number, dy: number) => {
  const win = senderWindow(e)
  if (!win || !resizeFrom || typeof edge !== 'string' || !Number.isFinite(dx) || !Number.isFinite(dy)) return
  const [minW, minH] = win.getMinimumSize()
  let { x, y, width, height } = resizeFrom
  // n/s/e/w = edges; a corner handle combines two letters (e.g. "se")
  if (edge.includes('e')) width = Math.max(minW, resizeFrom.width + dx)
  if (edge.includes('s')) height = Math.max(minH, resizeFrom.height + dy)
  if (edge.includes('w')) {
    width = Math.max(minW, resizeFrom.width - dx)
    x = resizeFrom.x + resizeFrom.width - width // the right edge stays in place
  }
  if (edge.includes('n')) {
    height = Math.max(minH, resizeFrom.height - dy)
    y = resizeFrom.y + resizeFrom.height - height
  }
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
})
ipcMain.handle('window:openChat', (_e, key: string) => openChat(asKey(key)))
ipcMain.handle('window:openRoom', (_e, key: string) => openRoom(asKey(key)))
ipcMain.handle('window:toggleChat', (_e, key: string) => toggleWindow(`chat:${asKey(key)}`, () => openChat(key)))
ipcMain.handle('window:toggleRoom', (_e, key: string) => toggleWindow(`room:${asKey(key)}`, () => openRoom(key)))
ipcMain.handle('windows:visible', () => visibleWindowIds())
watchVisibleWindows((ids) => broadcast('windows:visible', ids))

// …and the core notifies all windows when something changes
core.on('state', (state: CoreState) => {
  lastState = state
  broadcast('core:state', state)
  notifier.onState(state)
  tray?.refresh() // online friends / new rooms in the menu
  // Room left or removed from: its window no longer has a reason to exist
  const roomKeys = new Set(state.rooms.map((r) => r.key))
  for (const win of allWindows()) {
    const id = getWindowId(win)
    if (id?.startsWith('room:') && !roomKeys.has(id.slice(5))) win.close()
  }
})
core.on('voice-signal', (signal) => broadcast('voice:signal', signal))
// The friend I am calling refused: their window hangs up and says so
core.on('call-declined', (from: string) => getWindow(`chat:${from}`)?.webContents.send('call:declined'))
core.on('message', (convId, msg) => {
  broadcast('chat:message', convId, msg)
  notifier.onMessage(convId, msg)
})

//& Focus: a conversation in the foreground = messages read
app.on('browser-window-focus', (_e, win: BrowserWindow) => {
  const id = getWindowId(win)
  if (id?.startsWith('chat:') || id?.startsWith('room:')) notifier.markRead(id.slice(5))
})
// New window: it receives the current unread badge
app.on('browser-window-created', (_e, win) => win.once('ready-to-show', notifier.refreshOverlay))

//& Lifecycle
// Second launch (e.g. click on a link): the already-open instance receives its arguments
app.on('second-instance', (_e, argv) => {
  if (!receiveLink(argv)) openHome()
})

app.whenReady().then(async () => {
  await setupI18n()
  lockPermissions()
  setupSpellcheck()
  core.setStealth(settings.get().stealth)
  core.setImageTtl(settings.get().imageTtlHours)
  await core.start()
  // Shared images that outlived their delay are erased from the disk: at startup, then every 30 minutes
  const purge = (): void => void core.purgeExpiredImages().catch((err) => console.error('purge failed', err))
  setTimeout(purge, 20_000)
  setInterval(purge, 30 * 60_000)
  notifier.onState(core.getState(), true) // requests already present: no notification
  tray = createTray({
    getState: () => core.getState(),
    getUnread: notifier.getUnread,
    openHome,
    openChat,
    openRoom,
    openSettings
  })
  // Windows registers the protocol for the installed app (in dev it would point to the bare electron.exe)
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)
  // Launched by a click on a link: the link is in the arguments (macOS: received by 'open-url' below);
  // otherwise only the home window opens
  if (!receiveLink(launchLink ? [launchLink] : process.argv)) openHome()
  startUpdater(() => settings.get().autoUpdate)
})

// macOS gives a clicked junglemesh:// link through this event, not in the arguments (and possibly before 'ready')
let launchLink: string | null = null
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (app.isReady()) receiveLink([url])
  else launchLink = url
})
// macOS: a click on the Dock icon when no window is open brings the home window back
app.on('activate', () => {
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) openHome()
})

// All windows closed: we do NOT quit, the app stays in the notification area.
// (merely listening to this event cancels Electron's default "quit")
app.on('window-all-closed', () => {
  const session = loadSession()
  if (session.trayHintShown) return
  // First time: we explain where the app went (otherwise people think they quit it)
  notifier.notify(t('tray.stillRunningTitle'), t('tray.stillRunningBody'), openHome)
  saveSession({ trayHintShown: true })
})

// Quitting waits for the P2P core to finish its saves (contacts.json…) and close the logs cleanly.
// The first 'before-quit' is held back, the real quit is called again once the core is stopped.
let stopping = false
app.on('before-quit', (e) => {
  if (stopping) return
  stopping = true
  e.preventDefault()
  const timeout = new Promise((r) => setTimeout(r, 5000)) // a stuck network close must not block the quit
  void Promise.race([core.stop().catch((err) => console.error('stop failed', err)), timeout]).then(() => app.quit())
})
