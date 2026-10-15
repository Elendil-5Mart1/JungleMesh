//* Zustand store: local copy (in THIS window) of the P2P core's state
// The source of truth remains the main process; this store just
// receives its updates and makes them available to the components.
import { create } from 'zustand'
import type { AppSettings, ChatMessage, CoreState, UnreadCounts } from '../../../shared/types'

interface CoreStore extends Partial<CoreState> {
  messages: Record<string, ChatMessage[]> // friend key → messages
  unread: UnreadCounts // friend key → unread count (counted by the main process)
  setUnread: (unread: UnreadCounts) => void
  settings: AppSettings | null // app settings (null while loading)
  setSettings: (settings: AppSettings) => void
  visibleWindows: string[] // windows on screen: 'chat:<key>', 'room:<key>'
  setVisibleWindows: (ids: string[]) => void
  setState: (state: CoreState) => void
  setHistory: (key: string, list: ChatMessage[]) => void
  addMessage: (key: string, msg: ChatMessage) => void
}

export const useCoreStore = create<CoreStore>((set) => ({
  messages: {},
  unread: {},
  setUnread: (unread) => set({ unread }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  visibleWindows: [],
  setVisibleWindows: (visibleWindows) => set({ visibleWindows }),
  setState: (state) => set(state),
  setHistory: (key, list) => set((s) => ({ messages: { ...s.messages, [key]: list } })),
  addMessage: (key, msg) =>
    set((s) => {
      const list = s.messages[key] ?? []
      if (list.some((m) => m.id === msg.id)) return s // anti-duplicate
      // Sorted by date: after a reconnection, older messages arrive late
      const next = [...list, msg].sort((a, b) => a.ts - b.ts)
      return { messages: { ...s.messages, [key]: next } }
    })
}))

//& Single hook-up to the IPC events (called once when the module loads)
void window.api.getState().then(useCoreStore.getState().setState)
window.api.onState(useCoreStore.getState().setState)
window.api.onMessage(useCoreStore.getState().addMessage)
void window.api.getUnread().then(useCoreStore.getState().setUnread)
window.api.onUnread(useCoreStore.getState().setUnread)
void window.api.getSettings().then(useCoreStore.getState().setSettings)
window.api.onSettings(useCoreStore.getState().setSettings)
void window.api.getVisibleWindows().then(useCoreStore.getState().setVisibleWindows)
window.api.onVisibleWindows(useCoreStore.getState().setVisibleWindows)
