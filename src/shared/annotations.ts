//* Changes made to a message after it was sent: edit (by its author) and emoji reactions (by anyone)
// Each one is an entry in the log of the person who makes it (see journal.ts): the signature of that log
// proves who reacted / who edited. The same rules run in the main process (history) and in the windows
// (live updates), so they live here, shared by both.
import type { ChatMessage } from './types'

export type Annotation =
  | { kind: 'edit'; id: string; by: string; text: string; ts: number }
  | { kind: 'react'; id: string; to: string; by: string; emoji: string; on: boolean; ts: number }

export const MAX_REACTION_KINDS = 20 // different emojis on one message (anti-spam)

// An emoji, and only an emoji: a pictogram (or a flag), short, without spaces
export const isEmoji = (raw: unknown): raw is string =>
  typeof raw === 'string' && raw.length <= 16 && !/\s/.test(raw) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(raw)

//& One annotation applied to one message (returns the same object if nothing changes)
export const annotate = (m: ChatMessage, a: Annotation): ChatMessage => {
  if (a.id !== m.id || m.system) return m
  if (a.kind === 'edit') {
    // Only the author edits, and an older edit arriving late does not overwrite a newer one
    if (m.from !== a.by || (m.edited ?? 0) > a.ts) return m
    return { ...m, text: a.text, edited: a.ts }
  }
  if (m.from !== a.to) return m // the reaction targets the message of THIS author (ids alone could be forged)
  const who = m.reactions?.[a.emoji] ?? []
  if (a.on === who.includes(a.by)) return m
  if (a.on && who.length === 0 && Object.keys(m.reactions ?? {}).length >= MAX_REACTION_KINDS) return m
  const next = a.on ? [...who, a.by] : who.filter((k) => k !== a.by)
  const reactions = { ...m.reactions, [a.emoji]: next }
  if (next.length === 0) delete reactions[a.emoji]
  return { ...m, reactions }
}

//& Annotations applied to a whole history, in date order (the latest reaction / edit of each person wins)
export const annotateAll = (messages: ChatMessage[], annotations: Annotation[]): ChatMessage[] => {
  if (annotations.length === 0) return messages
  const out = [...messages]
  // id → positions: an id is only unique per author (another member could reuse it), annotate checks the author
  const index = new Map<string, number[]>()
  out.forEach((m, i) => index.set(m.id, [...(index.get(m.id) ?? []), i]))
  for (const a of [...annotations].sort((x, y) => x.ts - y.ts)) {
    for (const i of index.get(a.id) ?? []) out[i] = annotate(out[i], a)
  }
  return out
}
