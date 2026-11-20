//* Global state (Zustand): the core's state and the open conversations, as on the desktop
import { create } from 'zustand'
import { Paths } from 'expo-file-system'
import type { ChatMessage, CoreState } from '../../src/shared/types'
import type { Annotation } from '../../src/shared/annotations'
import { annotateList, insertMessage, mergeHistory, removeMessage } from '../../src/shared/messageList'
import { call, on } from './bridge'

interface CoreStore {
  state: CoreState | null // null while the core starts
  error: string | null // the core could not start
  messages: Record<string, ChatMessage[]> // conversation key (friend or room) → messages, once opened
  boot: () => Promise<void>
  loadHistory: (key: string) => Promise<void>
}

// The app's private folder (file:///data/user/0/org.junglemesh.app/files/) as a plain path for Bare
const dataDir = (): string => decodeURIComponent(new URL(Paths.document.uri).pathname) + 'junglemesh'

let booted = false

export const useCore = create<CoreStore>((set, get) => {
  // Applies a change to ONE conversation's list, only if it is loaded (the list rules: shared/messageList.ts)
  const update = (key: string, change: (list: ChatMessage[]) => ChatMessage[]) =>
    set((s) => {
      const list = s.messages[key]
      if (!list) return s // never opened: the history load will include it
      const next = change(list)
      return next === list ? s : { messages: { ...s.messages, [key]: next } }
    })

  return {
    state: null,
    error: null,
    messages: {},

    boot: async () => {
      if (booted) return // Fast Refresh re-runs the layout's effect: subscribe only once
      booted = true
      on('state', (state: CoreState) => set({ state }))
      on('message', (key: string, msg: ChatMessage) => update(key, (list) => insertMessage(list, msg)))
      on('message-deleted', (key: string, id: string, author: string) => update(key, (list) => removeMessage(list, id, author)))
      on('message-annotated', (key: string, a: Annotation) => update(key, (list) => annotateList(list, a)))
      try {
        set({ state: await call<CoreState>('init', dataDir()) })
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    // The conversation is marked "open" BEFORE asking, so a message arriving
    // while the history is being read is kept and merged in, instead of being lost
    loadHistory: async (key) => {
      if (!get().messages[key]) set((s) => ({ messages: { ...s.messages, [key]: [] } }))
      const before = new Set(get().messages[key].map((m) => m.id))
      const history = await call<ChatMessage[]>('getHistory', key)
      set((s) => ({ messages: { ...s.messages, [key]: mergeHistory(history, s.messages[key], before) } }))
    }
  }
})
