//* A conversation's message list, kept up to date from the core's events
// Pure functions (a new array, or the same one if nothing changes), shared by the desktop
// windows (renderer/src/stores/useCoreStore.ts) and the mobile app (mobile/src/store.ts).
import type { ChatMessage } from './types'
import { annotate, type Annotation } from './annotations'

// History read from the core + the messages that arrived live while it was being read
export const mergeHistory = (history: ChatMessage[], live: ChatMessage[], before: Set<string>): ChatMessage[] => {
  const ids = new Set(history.map((m) => m.id))
  const arrived = live.filter((m) => !before.has(m.id) && !ids.has(m.id))
  return arrived.length ? [...history, ...arrived].sort((a, b) => a.ts - b.ts) : history
}

// A new message, sorted by date: usually the newest (appended), but after a reconnection
// older messages arrive late. Anti-duplicate: an id already present is ignored.
export const insertMessage = (list: ChatMessage[], msg: ChatMessage): ChatMessage[] => {
  if (list.some((m) => m.id === msg.id)) return list
  let i = list.length
  while (i > 0 && list[i - 1].ts > msg.ts) i--
  return [...list.slice(0, i), msg, ...list.slice(i)]
}

// Only the author can delete a message: the author is checked too, an id alone is not enough
export const removeMessage = (list: ChatMessage[], id: string, author: string): ChatMessage[] =>
  list.filter((m) => !(m.id === id && m.from === author))

// Edit or reaction received live: same rules as the history (annotations.ts).
// Every message with that id goes through annotate, which keeps only the one of the right author.
export const annotateList = (list: ChatMessage[], annotation: Annotation): ChatMessage[] => {
  let changed = false
  const next = list.map((m) => {
    const after = annotate(m, annotation)
    if (after !== m) changed = true
    return after
  })
  return changed ? next : list
}
