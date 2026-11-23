//* Unread messages of the phone: the mobile counterpart of the desktop's notifier.ts (counters part only)
// Counted in the worker and not in the UI: the worker receives every message, even for a conversation
// that was never opened (whose list is not loaded in the UI store). Saved in unread.json, next to the
// settings, so the counters survive a restart of the app, as on the desktop.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage, CoreState, UnreadCounts } from '../../src/shared/types'

const FILE = 'unread.json'

export const createUnread = (dataDir: string, myKey: () => string, emit: (unread: UnreadCounts) => void) => {
  const path = join(dataDir, FILE)
  let unread: UnreadCounts = {}
  // Conversation on screen right now (set by the UI): its messages are read as they arrive.
  // null = home screen, settings, or the app in the background.
  let active: string | null = null

  // A friend coming back online delivers all their waiting messages in one go:
  // the file and the UI are only updated once per burst (same trick as the desktop)
  let flushQueued = false
  const changed = () => {
    if (flushQueued) return
    flushQueued = true
    setTimeout(() => {
      flushQueued = false
      emit({ ...unread })
      // Atomic write (.tmp then rename), like mobile-settings.json
      void writeFile(`${path}.tmp`, JSON.stringify(unread))
        .then(() => rename(`${path}.tmp`, path))
        .catch(() => {}) // lost counters are not worth crashing the worker
    }, 0)
  }

  return {
    load: async () => {
      try {
        const raw = JSON.parse(await readFile(path, 'utf-8'))
        // Only positive whole numbers: a hand-edited or broken file never breaks the start
        for (const [key, n] of Object.entries(raw ?? {})) if (Number.isSafeInteger(n) && (n as number) > 0) unread[key] = n as number
      } catch {
        unread = {} // first start: nothing unread
      }
    },

    get: (): UnreadCounts => ({ ...unread }),

    // New message from the core (it also emits MY messages and system messages: ignored)
    onMessage(convId: string, msg: ChatMessage) {
      if (msg.system || msg.from === myKey() || convId === active) return
      unread[convId] = (unread[convId] ?? 0) + 1
      changed()
    },

    // A conversation comes on screen (key) or the user leaves it (null): its messages are read
    setActive(key: string | null) {
      active = key
      if (key && unread[key]) {
        delete unread[key]
        changed()
      }
    },

    markRead(key: string) {
      if (!unread[key]) return
      delete unread[key]
      changed()
    },

    // Friend removed, room left or deleted: its counter goes with it (otherwise a ghost badge could stay)
    onState(state: CoreState) {
      const known = new Set([...state.friends.map((f) => f.key), ...state.rooms.map((r) => r.key)])
      let removed = false
      for (const key of Object.keys(unread)) {
        if (!known.has(key)) {
          delete unread[key]
          removed = true
        }
      }
      if (removed) changed()
    }
  }
}
