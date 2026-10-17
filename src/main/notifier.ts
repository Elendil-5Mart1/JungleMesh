//* Unread messages, Windows notifications and red badge on the taskbar icon
// Everything happens in the main process: it is the one that knows which window has focus.
import { app, BrowserWindow, Notification, type NativeImage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, ChatMessage, CoreState, UnreadCounts } from '../shared/types'
import { unreadDot } from './icons'
import { t } from '../shared/i18n'
import { allWindows, getWindow } from './windows'

// What we need to know about a conversation (DM or room) to signal it
export interface ConvInfo {
  windowId: string // 'chat:<key>' or 'room:<key>'
  title: string // notification title
  open: () => void
}

interface NotifierDeps {
  myKey: () => string
  describe: (convId: string, msg: ChatMessage) => ConvInfo
  openHome: () => void
  openIncoming: (key: string) => void // incoming call popup
  closeIncoming: (key: string) => void
  settings: () => AppSettings
  onChange: (unread: UnreadCounts) => void // notify the windows (badges)
}

//& Readable preview of a markdown message (a notification only shows plain text)
const preview = (text: string): string => {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, ' [code] ')
    .replace(/[`*_~>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 120 ? `${plain.slice(0, 117)}…` : plain
}

export const createNotifier = (deps: NotifierDeps) => {
  const file = join(app.getPath('userData'), 'unread.json')
  let unread: UnreadCounts = {}
  try {
    unread = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // no file yet: nothing unread
  }

  let dot: NativeImage | null = null // created on first use (after app.whenReady)
  const knownInvites = new Set<string>() // 'friend:<key>' / 'room:<key>' already signaled
  // A notification that is not referenced can be picked up by the garbage collector,
  // and its click would then do nothing: we keep them until they are closed.
  const alive = new Set<Notification>()

  const total = (): number => Object.values(unread).reduce((a, b) => a + b, 0)

  // Badge on the windows (in practice only the home window has a taskbar button)
  const applyOverlay = (): void => {
    const n = total()
    dot ??= unreadDot()
    for (const win of allWindows()) win.setOverlayIcon(n > 0 ? dot : null, n > 0 ? t('tray.unread', { count: n }) : '')
  }

  // A friend coming back online delivers all their waiting messages in one go: the counters change
  // N times in the same turn, but the file, the badge and the windows are only updated once
  let flushQueued = false
  const changed = (): void => {
    if (flushQueued) return
    flushQueued = true
    setImmediate(() => {
      flushQueued = false
      try {
        writeFileSync(file, JSON.stringify(unread))
      } catch (err) {
        console.error('unread: write failed', err)
      }
      applyOverlay()
      deps.onChange({ ...unread })
    })
  }

  // One toast per conversation every few seconds at most (the next ones would only pile up in the action center)
  const TOAST_GAP_MS = 4000
  const lastToast = new Map<string, number>()
  const toastAllowed = (convId: string): boolean => {
    const now = Date.now()
    if (now - (lastToast.get(convId) ?? 0) < TOAST_GAP_MS) return false
    lastToast.set(convId, now)
    return true
  }

  // Our own notification sound, played by a window (the main process cannot play audio).
  // At most one every 800 ms: a burst of messages makes one sound, not ten. false = no window to play it.
  let lastSound = 0
  const playSound = (): boolean => {
    if (!deps.settings().notifSound) return true // sound off: and not the Windows one either
    const win = getWindow('home') ?? allWindows()[0]
    if (!win) return false
    const now = Date.now()
    if (now - lastSound > 800) win.webContents.send('notify:sound')
    lastSound = now
    return true
  }

  // Incoming call: a friend is in our 1-to-1 call and I am not (yet). A popup per caller
  // (Join / Decline), and one window rings, like the notification sound.
  const ringing = new Set<string>() // keys of the friends calling me
  const declined = new Set<string>() // calls refused: silent until this friend leaves the call
  let ringWindow: BrowserWindow | null = null
  let lastState: CoreState | null = null
  const updateRing = (state: CoreState): void => {
    lastState = state
    const me = deps.myKey()
    const calling = state.friends
      .filter((f) => f.status === 'accepted' && f.call.includes(f.key) && !f.call.includes(me) && !deps.settings().muted.includes(f.key))
      .map((f) => f.key)
    for (const key of declined) if (!calling.includes(key)) declined.delete(key) // call over: may ring again next time
    const now = new Set(calling.filter((key) => !declined.has(key)))
    for (const key of now) {
      if (ringing.has(key)) continue
      deps.openIncoming(key)
      const home = getWindow('home')
      if (home && !home.isFocused() && deps.settings().flash) home.flashFrame(true)
    }
    for (const key of ringing) if (!now.has(key)) deps.closeIncoming(key) // answered, refused or hung up
    ringing.clear()
    for (const key of now) ringing.add(key)
    const ring = ringing.size > 0 && deps.settings().ringtone
    if (ring && !ringWindow) {
      ringWindow = getWindow('home') ?? allWindows()[0] ?? null
      ringWindow?.webContents.send('notify:ring', true)
    } else if (!ring && ringWindow) {
      if (!ringWindow.isDestroyed()) ringWindow.webContents.send('notify:ring', false)
      ringWindow = null
    }
  }

  // `silent`: our own sound already played (otherwise Windows plays its default toast sound)
  const notify = (title: string, body: string, onClick: () => void, silent = false): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent })
    alive.add(n)
    n.on('click', () => {
      alive.delete(n)
      onClick()
    })
    n.on('close', () => alive.delete(n))
    n.show()
  }

  // Does an app window have focus? If so, no toast (the badge is enough)
  const appFocused = (): boolean => BrowserWindow.getFocusedWindow() !== null

  return {
    getUnread: (): UnreadCounts => ({ ...unread }),
    notify,

    // New message received (the core also emits MY messages and system messages: ignored)
    onMessage(convId: string, msg: ChatMessage): void {
      if (msg.system || msg.from === deps.myKey()) return
      if (deps.settings().muted.includes(convId)) return // muted conversation: nothing at all
      const conv = deps.describe(convId, msg)
      if (getWindow(conv.windowId)?.isFocused()) return // already in front of the user: nothing to signal

      unread[convId] = (unread[convId] ?? 0) + 1
      changed()
      // Conversation windows have no button: the home window is the one that flashes
      const home = getWindow('home')
      if (home && !home.isFocused() && deps.settings().flash) home.flashFrame(true)
      const played = playSound()
      if (!appFocused() && deps.settings().notifications && toastAllowed(convId)) {
        const body = deps.settings().hideNotificationContent ? t('notif.newMessage') : preview(msg.file ? `📎 ${msg.file.name}` : msg.text)
        notify(conv.title, body, conv.open, played)
      }
    },

    // A conversation comes to the foreground → its messages are read
    markRead(convId: string): void {
      if (!unread[convId]) return
      delete unread[convId]
      changed()
    },

    // New friend request or room invitation? (comparison with the ones already known)
    onState(state: CoreState, silent = false): void {
      const current = new Map<string, string>() // id → notification text
      for (const f of state.friends) if (f.status === 'incoming') current.set(`friend:${f.key}`, t('notif.friendRequest', { name: f.name }))
      for (const r of state.rooms) {
        if (r.status === 'invited') current.set(`room:${r.key}`, t('notif.roomInvite', { who: r.invitedBy, room: r.name }))
      }
      for (const [id, text] of current) {
        if (knownInvites.has(id)) continue
        knownInvites.add(id)
        const title = t(id.startsWith('room:') ? 'notif.roomInviteTitle' : 'notif.friendRequestTitle')
        if (silent) continue
        const played = playSound()
        if (!appFocused() && deps.settings().notifications) notify(title, text, deps.openHome, played)
      }
      // Accepted or declined: we forget it (it may notify again later)
      for (const id of knownInvites) if (!current.has(id)) knownInvites.delete(id)
      updateRing(state)
    },

    // "Decline" in the popup: this call stops ringing here (the caller is not told, they just wait)
    decline(key: string): void {
      declined.add(key)
      if (lastState) updateRing(lastState)
    },

    // When a window opens: apply the current badge to it
    refreshOverlay: applyOverlay
  }
}
