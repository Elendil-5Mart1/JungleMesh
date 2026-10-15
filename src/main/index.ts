//* Entry point of the Electron main process
import { app, dialog, ipcMain, session, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import type { AppSettings, Avatar, ChannelKind, ChatMessage, CoreState } from '../shared/types'
import { P2PCore } from './p2p/core'
import { createNotifier, type ConvInfo } from './notifier'
import { findInviteCode, SCHEME } from './inviteLink'
import { createSettings } from './settings'
import { createTray } from './tray'
import { setupI18n, t } from '../shared/i18n'
import { loadSession, saveSession } from './windowState'
import {
  broadcast,
  getWindow,
  allWindows,
  getWindowId,
  openWindow,
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
  const identity = ['corestore', 'contacts.json', 'rooms.json', 'avatars.json', 'unread.json', 'session.json', 'identity.json']
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

// A single instance per profile (otherwise two P2P cores with the same identity)
// (app.exit and not app.quit: quit is asynchronous and would let the code carry on)
if (!app.requestSingleInstanceLock()) app.exit(0)

// Windows groups notifications by "AppUserModelId": without it, no toast.
// In dev we reuse the path of electron.exe (the only id Windows already knows).
app.setAppUserModelId(app.isPackaged ? 'org.junglemesh.app' : process.execPath)

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
// The home window has its taskbar button; conversations do not (skipTaskbar).
const openHome = (): void => {
  openWindow({
    id: 'home',
    route: '/home',
    width: 340,
    height: 600,
    title: profile ? `JungleMesh (${profile})` : 'JungleMesh',
    minimizable: true
  })
}

const friendName = (key: string): string => core.getState().friends.find((f) => f.key === key)?.name ?? t('chat.friend')

const openChat = (key: string): void => {
  openWindow({
    id: `chat:${key}`,
    route: `/chat/${key}`,
    width: 520,
    height: 640,
    title: friendName(key),
    skipTaskbar: true
  })
}

const openRoom = (key: string): void => {
  const title = core.roomName(key) ?? t('room.fallbackName')
  openWindow({ id: `room:${key}`, route: `/room/${key}`, width: 980, height: 640, title, skipTaskbar: true })
}

// Settings: a single window, like the others without a taskbar button
const openSettings = (): void => {
  openWindow({ id: 'settings', route: '/settings', width: 760, height: 560, title: t('settings.title'), skipTaskbar: true })
}

// Toggle (click in the home window): closed or hidden → show it; on screen → close it
const toggleWindow = (id: string, open: () => void): void => {
  const win = getWindow(id)
  if (win?.isVisible()) win.close()
  else open()
}

//& Unread and notifications
// convId = key of a friend (DM) or of a room: we describe the conversation to the notifier
const describe = (convId: string, msg: ChatMessage): ConvInfo => {
  const room = core.getState().rooms.find((r) => r.key === convId)
  if (!room) return { windowId: `chat:${convId}`, title: friendName(convId), open: () => openChat(convId) }
  const author = room.members.find((m) => m.key === msg.from)?.name ?? '?'
  const channel = room.channels.find((c) => c.id === (msg.channel ?? 'general'))?.name ?? 'general'
  return { windowId: `room:${convId}`, title: `${author} · ${room.name} #${channel}`, open: () => openRoom(convId) }
}

let tray: ReturnType<typeof createTray> | null = null // created once the app is ready

// App settings: every change is broadcast to all windows
// Settings that apply to the windows themselves (screen capture, local IP leak in WebRTC)
const hardenWindow = (win: BrowserWindow): void => {
  win.setContentProtection(settings.get().contentProtection)
  // Only publish the default network interface: not the list of all the machine's local addresses
  win.webContents.setWebRTCIPHandlingPolicy('default_public_interface_only')
}
const applyWindowSettings = (): void => allWindows().forEach(hardenWindow)

const settings = createSettings((s: AppSettings) => {
  broadcast('settings:changed', s)
  applyWindowSettings()
})
app.on('browser-window-created', (_e, win) => hardenWindow(win))

const notifier = createNotifier({
  myKey: () => core.getState().me.publicKey,
  describe,
  openHome,
  settings: settings.get,
  onChange: (unread) => {
    broadcast('unread:changed', unread)
    tray?.refresh()
  }
})

//& Security
// By default Electron grants ALL web permissions (camera, geolocation, notifications…): we only allow the microphone.
const grantable = (permission: string): boolean => permission === 'media'
const lockPermissions = (): void => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(grantable(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => grantable(permission))
}

// IPC messages must only come from our own pages (local file, or Vite server in dev)
const fromOurPages = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
  const url = e.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  return url.startsWith('file://') || (!!dev && url.startsWith(dev))
}
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
ipcMain.handle('friends:accept', (_e, key: string) => core.acceptRequest(key))
ipcMain.handle('friends:decline', (_e, key: string) => core.declineRequest(key))
ipcMain.handle('rooms:create', (_e, name: string) => core.createRoom(name))
ipcMain.handle('rooms:setAvatar', (_e, room: string, avatar: Avatar) => core.setRoomAvatar(room, avatar))
ipcMain.handle('rooms:createChannel', (_e, room: string, name: string, kind: ChannelKind) =>
  core.createChannel(room, name, kind)
)
ipcMain.handle('rooms:rename', (_e, room: string, name: string) => core.renameRoom(room, name))
ipcMain.handle('rooms:renameChannel', (_e, room: string, id: string, name: string) =>
  core.renameChannel(room, id, name)
)
ipcMain.handle('rooms:deleteChannel', (_e, room: string, id: string) => core.deleteChannel(room, id))
ipcMain.handle('rooms:kick', (_e, room: string, member: string) => core.kickFromRoom(room, member))
ipcMain.handle('rooms:leave', (_e, room: string) => core.leaveRoom(room))
ipcMain.handle('rooms:invite', (_e, room: string, friend: string) => core.inviteToRoom(room, friend))
ipcMain.handle('rooms:accept', (_e, room: string) => core.acceptRoomInvite(room))
ipcMain.handle('rooms:decline', (_e, room: string) => core.declineRoomInvite(room))
ipcMain.handle('chat:history', (_e, convId: string) => core.getHistory(asKey(convId)))
ipcMain.handle('chat:send', (_e, convId: string, text: string, channel?: string) =>
  core.send(asKey(convId), text, channel)
)
// Voice channels: if the window that is calling closes, we leave the channel (otherwise we stay there as a "ghost")
ipcMain.handle('voice:join', (e, room: string, chan: string) => {
  core.voiceJoin(room, chan)
  e.sender.once('destroyed', () => {
    const spot = core.getState().rooms.find((r) => r.key === room)?.voice[chan]
    if (spot?.includes(core.getState().me.publicKey)) core.voiceLeave()
  })
})
ipcMain.handle('voice:leave', () => core.voiceLeave())
ipcMain.handle('voice:signal', (_e, to: string, room: string, chan: string, data: unknown) =>
  core.voiceSignal(to, room, chan, data)
)
ipcMain.handle('invite:pending', () => pendingInvite)
ipcMain.handle('invite:clear', () => {
  pendingInvite = null
})
ipcMain.handle('unread:get', () => notifier.getUnread())
ipcMain.handle('settings:get', () => settings.get())
ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
  settings.update(patch)
  core.setStealth(settings.get().stealth)
  // Muting a conversation clears its unread count (otherwise the badge would stay lit)
  for (const key of settings.get().muted) notifier.markRead(key)
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
  core.setStealth(settings.get().stealth)
  await core.start()
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
  // Launched by a click on a link: the link is in the arguments; otherwise only the home window opens
  if (!receiveLink(process.argv)) openHome()
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

app.on('before-quit', () => void core.stop())
