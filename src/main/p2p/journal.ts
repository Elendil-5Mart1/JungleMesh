//* Common tools for Hypercore logs (private messages AND rooms)
import type { Avatar, CallEvent, ChannelKind, ChatMessage } from '../../shared/types'
import { isEmoji, type Annotation } from '../../shared/annotations'

const CALL_EVENTS: CallEvent[] = ['declined']

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_AVATAR_LENGTH = 100_000 // ~75 KB of image: large for 128×128
export const MAX_FILE_SIZE = 25 * 1024 * 1024 // a shared file (25 MB): it is stored by every recipient
export const MAX_IMAGE_PIXELS = 40_000_000 // an image shown in the chat: refuses "decompression bombs"

// What we write to a log. A missing `type` = message (format of the step-2 DMs).
// Only the room creator's log can contain the REGISTRY:
// 'meta', 'member', 'member-remove', 'channel', 'channel-rename', 'channel-delete' and 'room-delete'.
// Other members only write messages in their own log, plus two requests to the creator:
// 'join' (sign up a friend I invited) and 'leave' (I am leaving the room).
export type JournalEntry =
  | { type?: 'msg'; id: string; text: string; ts: number; channel?: string; file?: SharedFile }
  | { type: 'call'; id: string; event: CallEvent; ts: number } // DM call event, shown as a system line
  | { type: 'meta'; name?: string; avatar?: Avatar; imageTtl?: number | null; ts: number }
  | { type: 'member'; key: string; core: string; name: string; ts: number }
  | { type: 'member-remove'; key: string; name: string; reason: 'left' | 'kicked'; ts: number }
  | { type: 'channel'; id: string; name: string; kind: ChannelKind; ts: number }
  | { type: 'channel-rename'; id: string; name: string; ts: number }
  | { type: 'channel-delete'; id: string; ts: number }
  | { type: 'room-delete'; ts: number }
  | { type: 'join'; key: string; core: string; name: string; ts: number }
  | { type: 'leave'; ts: number }
  | { type: 'delete'; id: string; file?: string; ts: number } // the author deletes one of THEIR messages (tombstone)
  | { type: 'edit'; id: string; text: string; ts: number } // the author edits one of THEIR messages
  | { type: 'react'; id: string; to: string; emoji: string; on: boolean; ts: number } // reaction to the message `id` of `to`

//& Shared file: the bytes live in a SEPARATE Hypercore (one block = 64 KB), the message only points to it
export interface SharedFile {
  core: string // key (hex) of the log that holds the bytes
  name: string
  size: number
  mime: string // declared by the sender; for images it is checked against the real bytes before display
}

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
// Audio played in the chat (samples, demos…). Older versions see them as ordinary files.
export const AUDIO_MIMES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/flac', 'audio/mp4']

// File name: no path, no control or odd characters, never empty
export const cleanFileName = (raw: unknown): string => {
  const BACKSLASH = String.fromCharCode(92)
  const base = String(raw ?? '').split('/').pop()!.split(BACKSLASH).pop() ?? ''
  // Dropped: control characters, characters forbidden on Windows, and invisible direction marks
  // (U+202A-202E, U+2066-2069) that can reverse the end of a name to disguise its extension
  const clean = [...base]
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code > 31 && code !== 127 && !'<>:"|?*'.includes(ch) && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069)
    })
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
  return clean || 'file'
}

export const cleanFile = (raw: unknown): SharedFile | undefined => {
  const f = raw as Partial<SharedFile> | null
  if (!f || typeof f.core !== 'string' || !/^[0-9a-f]{64}$/.test(f.core)) return undefined
  if (!Number.isInteger(f.size) || (f.size as number) < 1 || (f.size as number) > MAX_FILE_SIZE) return undefined
  const known = typeof f.mime === 'string' && (IMAGE_MIMES.includes(f.mime) || AUDIO_MIMES.includes(f.mime))
  const mime = known ? (f.mime as string) : 'application/octet-stream'
  return { core: f.core, name: cleanFileName(f.name), size: f.size as number, mime }
}

// Files announced by messages we have seen (signed by their author): the only ones we agree to download
export const knownFiles = new Map<string, SharedFile & { author: string }>()
const MAX_KNOWN_FILES = 5000

//& Avatar received from a peer: only a raster image in base64
// (no SVG: an SVG can contain code; no remote URL: it would reveal the IP)
// Dimensions read from the image header, WITHOUT decoding it: a 75 KB PNG can declare 30000×30000 pixels
// and saturate the memory of the window that would display it ("decompression bomb").
export const MAX_AVATAR_SIDE = 512
export const imageSize = (bytes: Buffer): { w: number; h: number } | null => {
  if (bytes.length > 30 && bytes.readUInt32BE(0) === 0x89504e47) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) } // PNG: IHDR
  if (bytes.length > 10 && bytes.toString('latin1', 0, 3) === 'GIF') return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) }
  if (bytes.length > 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const kind = bytes.toString('latin1', 12, 16)
    if (kind === 'VP8X') return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) }
    if (kind === 'VP8 ') return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
    }
    return null
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: we look for the first SOFn segment (0xC0-0xCF excluding DHT/JPG/DAC), which carries the size
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++
        continue
      }
      const m = bytes[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) }
      i += 2 + (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 ? 0 : bytes.readUInt16BE(i + 2))
    }
  }
  return null
}

const AVATAR = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/
export const cleanAvatar = (raw: unknown): Avatar | undefined => {
  if (raw === null) return null // null = "I removed my avatar"
  if (typeof raw !== 'string' || raw.length > MAX_AVATAR_LENGTH || !AVATAR.test(raw)) return undefined
  const size = imageSize(Buffer.from(raw.slice(raw.indexOf(',') + 1), 'base64'))
  if (!size || size.w < 1 || size.h < 1 || size.w > MAX_AVATAR_SIDE || size.h > MAX_AVATAR_SIDE) return undefined // unreadable or oversized
  return raw
}

// Channel id: short, without odd characters
export const cleanChannelId = (raw: unknown): string | undefined =>
  typeof raw === 'string' && /^[a-z0-9-]{1,64}$/.test(raw) ? raw : undefined

// log → number of entries already processed (WeakMap: forgotten when the log disappears)
const processed = new WeakMap<object, number>()

//& Calls onNew(from) every time new entries are available locally
// (written by me, or received through replication). Entries already present when
// this is called are considered processed: read them with readRaw(core, 0).
export const watchJournal = (core: any, onNew: (from: number) => void | Promise<void>): void => {
  processed.set(core, core.contiguousLength)
  const onUpdate = async (): Promise<void> => {
    const from = processed.get(core) ?? 0
    if (core.contiguousLength <= from) return
    processed.set(core, core.contiguousLength)
    // Event listener: nobody awaits it, so an error (log closed meanwhile…) is logged here instead of
    // becoming an unhandled rejection
    await Promise.resolve(onNew(from)).catch((err) => console.error('journal: update failed', err))
  }
  core.on('append', onUpdate) // new entry written (by me) or announced (by a peer)
  core.on('download', onUpdate) // block received from a peer
}

// Raw entries available without waiting for the network (contiguousLength = no gap).
// Read by batches of parallel gets: one await per entry made a long history (thousands of messages)
// cost thousands of event-loop turns at every window opening.
const READ_BATCH = 256
export const readRaw = async (core: any, from = 0): Promise<unknown[]> => {
  const entries: unknown[] = []
  const end = core.contiguousLength
  for (let i = from; i < end; i += READ_BATCH) {
    const batch: Promise<unknown>[] = []
    for (let j = i; j < Math.min(end, i + READ_BATCH); j++) batch.push(core.get(j, { wait: false }))
    entries.push(...(await Promise.all(batch)))
  }
  return entries
}

//& Turns a raw entry into a displayable message (or null if it is not one)
// We never trust the content: every field is validated.
export const toMessage = (raw: unknown, author: string): ChatMessage | null => {
  const entry = raw as Partial<{ type: string; id: string; text: string; ts: number; channel: string; file: unknown; event: unknown }> | null
  // Call event ("X declined the call"): a system line, its author is the log's owner
  if (entry?.type === 'call') {
    if (typeof entry.id !== 'string' || !CALL_EVENTS.includes(entry.event as CallEvent)) return null
    const ts = Number.isFinite(entry.ts) ? (entry.ts as number) : 0
    return { id: entry.id.slice(0, 64), from: author, text: '', ts, system: true, call: entry.event as CallEvent }
  }
  if (!entry || (entry.type !== undefined && entry.type !== 'msg')) return null
  if (typeof entry.text !== 'string' || typeof entry.id !== 'string') return null
  const file = entry.file === undefined ? undefined : cleanFile(entry.file)
  if (entry.file !== undefined && !file) return null // malformed attachment: the whole message is ignored
  if (file) {
    if (knownFiles.size >= MAX_KNOWN_FILES) knownFiles.delete(knownFiles.keys().next().value as string)
    knownFiles.set(file.core, { ...file, author })
  }
  return {
    id: entry.id.slice(0, 64),
    from: author, // the author = the log's owner (signed), never a field of the message
    text: entry.text.slice(0, MAX_MESSAGE_LENGTH),
    ...(file && { file: { ...file, image: IMAGE_MIMES.includes(file.mime) } }),
    ts: Number.isFinite(entry.ts) ? (entry.ts as number) : 0,
    channel: cleanChannelId(entry.channel) // undefined = 'general' (or DM)
  }
}

//& Deletion: Hypercore is append-only, so deleting = the author appends a "tombstone" to THEIR OWN log.
// Readers hide the message. The log is the author's, so nobody can delete someone else's message.
// An attached image is then freed from the disk: its key goes to `orphanFiles` (emptied by the core).
export const orphanFiles = new Set<string>()

const deletionOf = (raw: unknown): { id: string; file?: string } | null => {
  const e = raw as Partial<{ type: string; id: unknown; file: unknown }> | null
  if (e?.type !== 'delete' || typeof e.id !== 'string') return null
  return { id: e.id.slice(0, 64), file: typeof e.file === 'string' && /^[0-9a-f]{64}$/.test(e.file) ? e.file : undefined }
}

// Ids deleted in these entries (the file key is only trusted if THIS author announced that file)
export const deletedIds = (raws: unknown[], author: string): string[] => {
  const ids: string[] = []
  for (const raw of raws) {
    const d = deletionOf(raw)
    if (!d) continue
    ids.push(d.id)
    if (d.file && knownFiles.get(d.file)?.author === author) orphanFiles.add(d.file)
  }
  return ids
}

// Messages minus the ones deleted by their author in the same entries
export const withoutDeleted = (raws: unknown[], messages: ChatMessage[], author: string): ChatMessage[] => {
  const ids = new Set(deletedIds(raws, author))
  return ids.size === 0 ? messages : messages.filter((m) => !(m.from === author && ids.has(m.id)))
}

// My own message (to delete it): returns what the tombstone must carry, or null if it is not mine / unknown
export const findOwnMessage = async (core: any, id: string): Promise<{ file?: string } | null> => {
  for (const raw of await readRaw(core)) {
    const e = raw as Partial<{ type: string; id: string; file: unknown }> | null
    if (e && (e.type === undefined || e.type === 'msg') && e.id === id) return { file: cleanFile(e.file)?.core }
  }
  return null
}

//& Edits and reactions written by `author` (rules in shared/annotations.ts). Ignored by older versions,
// which skip the unknown types: they simply show the original text, without reactions.
export const annotationsOf = (raws: unknown[], author: string): Annotation[] => {
  const out: Annotation[] = []
  for (const raw of raws) {
    const e = raw as Partial<{ type: string; id: unknown; text: unknown; to: unknown; emoji: unknown; on: unknown; ts: unknown }> | null
    if (typeof e?.id !== 'string' || typeof e.ts !== 'number' || !Number.isFinite(e.ts)) continue
    const id = e.id.slice(0, 64)
    if (e.type === 'edit' && typeof e.text === 'string') {
      out.push({ kind: 'edit', id, by: author, text: e.text.slice(0, MAX_MESSAGE_LENGTH), ts: e.ts })
    } else if (e.type === 'react' && typeof e.to === 'string' && /^[0-9a-f]{64}$/.test(e.to) && isEmoji(e.emoji) && typeof e.on === 'boolean') {
      out.push({ kind: 'react', id, to: e.to, by: author, emoji: e.emoji, on: e.on, ts: e.ts })
    }
  }
  return out
}

// Displayable messages of raw entries written by `author`, minus the ones they deleted in the same entries
export const messagesOf = (raws: unknown[], author: string): ChatMessage[] => {
  const messages: ChatMessage[] = []
  for (const raw of raws) {
    const msg = toMessage(raw, author)
    if (msg) messages.push(msg)
  }
  return withoutDeleted(raws, messages, author)
}

