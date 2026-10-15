//* Common tools for Hypercore logs (private messages AND rooms)
import type { Avatar, ChannelKind, ChatMessage } from '../../shared/types'

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_AVATAR_LENGTH = 100_000 // ~75 KB of image: large for 128×128

// What we write to a log. A missing `type` = message (format of the step-2 DMs).
// Only the room creator's log can contain the REGISTRY:
// 'meta', 'member', 'member-remove', 'channel', 'channel-rename' and 'channel-delete'.
// Other members only write messages in their own log, plus two requests to the creator:
// 'join' (sign up a friend I invited) and 'leave' (I am leaving the room).
export type JournalEntry =
  | { type?: 'msg'; id: string; text: string; ts: number; channel?: string }
  | { type: 'meta'; name?: string; avatar?: Avatar; ts: number }
  | { type: 'member'; key: string; core: string; name: string; ts: number }
  | { type: 'member-remove'; key: string; name: string; reason: 'left' | 'kicked'; ts: number }
  | { type: 'channel'; id: string; name: string; kind: ChannelKind; ts: number }
  | { type: 'channel-rename'; id: string; name: string; ts: number }
  | { type: 'channel-delete'; id: string; ts: number }
  | { type: 'join'; key: string; core: string; name: string; ts: number }
  | { type: 'leave'; ts: number }

//& Avatar received from a peer: only a raster image in base64
// (no SVG: an SVG can contain code; no remote URL: it would reveal the IP)
// Dimensions read from the image header, WITHOUT decoding it: a 75 KB PNG can declare 30000×30000 pixels
// and saturate the memory of the window that would display it ("decompression bomb").
export const MAX_AVATAR_SIDE = 512
const imageSize = (bytes: Buffer): { w: number; h: number } | null => {
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
    await onNew(from)
  }
  core.on('append', onUpdate) // new entry written (by me) or announced (by a peer)
  core.on('download', onUpdate) // block received from a peer
}

// Raw entries available without waiting for the network (contiguousLength = no gap)
export const readRaw = async (core: any, from = 0): Promise<unknown[]> => {
  const entries: unknown[] = []
  for (let i = from; i < core.contiguousLength; i++) entries.push(await core.get(i, { wait: false }))
  return entries
}

//& Turns a raw entry into a displayable message (or null if it is not one)
// We never trust the content: every field is validated.
export const toMessage = (raw: unknown, author: string): ChatMessage | null => {
  const entry = raw as Partial<{ type: string; id: string; text: string; ts: number; channel: string }> | null
  if (!entry || (entry.type !== undefined && entry.type !== 'msg')) return null
  if (typeof entry.text !== 'string' || typeof entry.id !== 'string') return null
  return {
    id: entry.id.slice(0, 64),
    from: author, // the author = the log's owner (signed), never a field of the message
    text: entry.text.slice(0, MAX_MESSAGE_LENGTH),
    ts: Number.isFinite(entry.ts) ? (entry.ts as number) : 0,
    channel: cleanChannelId(entry.channel) // undefined = 'general' (or DM)
  }
}

export const readMessages = async (core: any, author: string, from = 0): Promise<ChatMessage[]> => {
  const messages: ChatMessage[] = []
  for (const raw of await readRaw(core, from)) {
    const msg = toMessage(raw, author)
    if (msg) messages.push(msg)
  }
  return messages
}
