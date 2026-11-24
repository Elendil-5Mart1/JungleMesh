//* Zustand store: local copy (in THIS window) of the P2P core's state
// The source of truth remains the main process; this store just
// receives its updates and makes them available to the components.
import { create } from 'zustand'
import type { AppSettings, ChatMessage, CoreState, UnreadCounts } from '../../../shared/types'
import { playNotifSound, startRing } from '@/utils/notifSound'
import type { Annotation } from '../../../shared/annotations'
import { annotateList, insertMessage, mergeHistory, removeMessage } from '../../../shared/messageList'

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
  loadHistory: (key: string) => Promise<void>
  addMessage: (key: string, msg: ChatMessage) => void
  removeMessage: (key: string, id: string, author: string) => void
  annotateMessage: (key: string, annotation: Annotation) => void
}

export const useCoreStore = create<CoreStore>((set, get) => ({
  messages: {},
  unread: {},
  setUnread: (unread) => set({ unread }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  visibleWindows: [],
  setVisibleWindows: (visibleWindows) => set({ visibleWindows }),
  setState: (state) => set(state),
  setHistory: (key, list) => set((s) => ({ messages: { ...s.messages, [key]: list } })),
  // History from the core. The conversation is marked "displayed" BEFORE asking, so a message arriving
  // while the history is being read is kept (addMessage) and merged in, instead of being lost.
  loadHistory: async (key) => {
    if (!get().messages[key]) set((s) => ({ messages: { ...s.messages, [key]: [] } }))
    const before = new Set(get().messages[key].map((m) => m.id))
    const list = await window.api.getHistory(key)
    get().setHistory(key, mergeHistory(list, get().messages[key], before))
  },
  // The list rules (sorting, anti-duplicate, author checks) live in shared/messageList.ts
  addMessage: (key, msg) =>
    set((s) => {
      // Every window receives every message: only the conversations this window displays (history loaded)
      // are kept, otherwise the home window would pile up all the messages of all conversations for days
      const list = s.messages[key]
      if (!list) return s // not displayed here
      const next = insertMessage(list, msg)
      return next === list ? s : { messages: { ...s.messages, [key]: next } }
    }),
  removeMessage: (key, id, author) =>
    set((s) => (s.messages[key] ? { messages: { ...s.messages, [key]: removeMessage(s.messages[key], id, author) } } : s)),
  annotateMessage: (key, annotation) =>
    set((s) => {
      const list = s.messages[key]
      if (!list) return s // not displayed here (the next history load applies it)
      const next = annotateList(list, annotation)
      return next === list ? s : { messages: { ...s.messages, [key]: next } }
    })
}))

//& Single hook-up to the IPC events (called once when the module loads)
void window.api.getState().then(useCoreStore.getState().setState)
window.api.onState(useCoreStore.getState().setState)
window.api.onMessage(useCoreStore.getState().addMessage)
window.api.onMessageDeleted((key, id, author) => useCoreStore.getState().removeMessage(key, id, author))
window.api.onMessageAnnotated((key, annotation) => useCoreStore.getState().annotateMessage(key, annotation))
void window.api.getUnread().then(useCoreStore.getState().setUnread)
window.api.onUnread(useCoreStore.getState().setUnread)
void window.api.getSettings().then(useCoreStore.getState().setSettings)
window.api.onSettings(useCoreStore.getState().setSettings)
// A new message lifetime changes what the history shows (the core filters it): the conversations displayed
// in this window are re-read. Not at the first load of the settings (prev null): nothing to redo.
useCoreStore.subscribe((s, prev) => {
  if (!prev.settings || !s.settings || s.settings.messageTtlDays === prev.settings.messageTtlDays) return
  for (const key of Object.keys(s.messages)) void s.loadHistory(key)
})
// Opacity of the window backgrounds: a CSS variable read by glass() in the styles (live, no reload),
// and the material as an attribute (the pearly sheen of "Pearl" is pure CSS)
// (the store changes on every message and every state: the DOM is only touched when the settings object changes)
useCoreStore.subscribe((s, prev) => {
  if (s.settings === prev.settings) return
  const opacity = s.settings?.windowOpacity ?? 100
  const root = document.documentElement
  root.style.setProperty('--glass', String(opacity / 100))
  root.dataset.material = opacity < 100 ? (s.settings?.windowMaterial ?? 'none') : 'none'
})
void window.api.getVisibleWindows().then(useCoreStore.getState().setVisibleWindows)
window.api.onVisibleWindows(useCoreStore.getState().setVisibleWindows)
// Notification sound and ringtone requested by the main process (only one window receives them)
window.api.onNotifySound(() => void playNotifSound(useCoreStore.getState().settings))
let stopRing: (() => void) | null = null
window.api.onNotifyRing((on) => {
  stopRing?.()
  stopRing = on ? startRing('incoming', useCoreStore.getState().settings) : null
})
