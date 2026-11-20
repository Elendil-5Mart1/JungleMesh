//* Shared files and images: the bytes travel in their own Hypercore (one block = 64 KB),
// the chat message only carries a pointer to it (see SharedFile in journal.ts).
// Why a separate log: the conversation log stays small and fast to replicate, and a recipient only
// downloads the bytes when they are needed (an image being displayed, or a click on "Download").
// The same Corestore connection already replicates every log both sides have open: nothing else to set up.
// No size limit: a file from the disk is copied into its log block by block, and a download is written to the
// user's file the same way, so the whole file is never in memory. Only what must be in memory (an image shown
// in the chat, a sound for the player) stays under MAX_INLINE_SIZE (see cleanFile in journal.ts).
import { randomUUID } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import b4a from 'b4a'
import { t } from '../../shared/i18n'
import {
  AUDIO_MIMES,
  IMAGE_MIMES,
  MAX_IMAGE_PIXELS,
  MAX_INLINE_SIZE,
  imageSize,
  knownFiles,
  type SharedFile
} from './journal'

const CHUNK = 64 * 1024
const FETCH_TIMEOUT = 30_000 // ms to receive the first block (the sender may be offline)
const APPEND_BATCH = 16 // blocks written to the log at once (1 MB) when copying a file from the disk
const PROGRESS_STEPS = 200 // progress reports per transfer at most (one per block would flood the windows)

// What the bytes really are, from their first bytes (the declared type is never trusted)
const sniffMime = (bytes: Buffer): string | null => {
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length > 6 && bytes.toString('latin1', 0, 3) === 'GIF') return 'image/gif'
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp'
  // Audio: tags / headers of the usual formats
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WAVE')
    return 'audio/wav'
  if (bytes.length > 4 && bytes.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg'
  if (bytes.length > 4 && bytes.toString('latin1', 0, 4) === 'fLaC') return 'audio/flac'
  if (bytes.length > 12 && bytes.toString('latin1', 4, 8) === 'ftyp' && bytes.toString('latin1', 8, 11) === 'M4A') return 'audio/mp4'
  // MP3: ID3 tag, or directly an MPEG frame (11 bits of sync at 1; never confused with JPEG's FF D8)
  if (bytes.length > 3 && (bytes.toString('latin1', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
    return 'audio/mpeg'
  return null
}

export class FileManager {
  private store: any
  private cache = new Map<string, Promise<Buffer>>() // image core key → bytes being read or already read
  private onProgress: (coreKey: string, done: number, total: number) => void

  constructor(store: any, onProgress: (coreKey: string, done: number, total: number) => void) {
    this.store = store
    this.onProgress = onProgress
  }

  // Sender: stores the bytes in a new log and returns what the message must carry
  // `name` must already be cleaned (cleanFileName)
  // Bytes already in memory (an image pasted from the clipboard has no file on the disk): small by nature
  async publish(name: string, data: Buffer): Promise<SharedFile> {
    if (data.length > MAX_INLINE_SIZE) throw new Error(t('err.fileTooBig', { max: MAX_INLINE_SIZE / 1024 / 1024 }))
    async function* chunks(): AsyncGenerator<Buffer> {
      for (let i = 0; i < data.length; i += CHUNK) yield data.subarray(i, i + CHUNK)
    }
    return this.publishBlocks(name, chunks())
  }

  // A file from the disk, any size: read block by block, never whole
  async publishPath(name: string, path: string): Promise<SharedFile> {
    const handle = await open(path, 'r')
    async function* chunks(): AsyncGenerator<Buffer> {
      for (;;) {
        // A block is always full (except the last one): the receiver checks the count of blocks against the size
        const block = Buffer.alloc(CHUNK)
        let filled = 0
        while (filled < CHUNK) {
          const { bytesRead } = await handle.read(block, filled, CHUNK - filled, null)
          if (bytesRead === 0) break
          filled += bytesRead
        }
        if (filled > 0) yield block.subarray(0, filled)
        if (filled < CHUNK) return
      }
    }
    try {
      return await this.publishBlocks(name, chunks())
    } finally {
      await handle.close()
    }
  }

  private async publishBlocks(name: string, chunks: AsyncIterable<Buffer>): Promise<SharedFile> {
    const core = this.store.get({ name: `file:${randomUUID()}`, valueEncoding: 'binary' })
    await core.ready()
    let size = 0
    let mime: string | null = null
    let batch: Buffer[] = []
    for await (const block of chunks) {
      if (size === 0) mime = sniffMime(block) // the first block is enough to recognize the format
      size += block.length
      batch.push(block)
      if (batch.length === APPEND_BATCH) {
        await core.append(batch)
        batch = []
      }
    }
    if (batch.length > 0) await core.append(batch)
    if (size < 1) {
      await core.close().catch(() => {})
      throw new Error(t('err.fileEmpty'))
    }
    return { core: b4a.toString(core.key, 'hex'), name, size, mime: mime ?? 'application/octet-stream' }
  }

  // Reads all the bytes of an image or a sound announced by a message (the only ones under MAX_INLINE_SIZE).
  // Only images are kept in memory afterwards: they are displayed again and again.
  private read(coreKey: string): Promise<Buffer> {
    const info = knownFiles.get(coreKey)
    if (!info) return Promise.reject(new Error(t('err.fileUnknown')))
    if (info.size > MAX_INLINE_SIZE) return Promise.reject(new Error(t('err.fileUnavailable')))
    if (!IMAGE_MIMES.includes(info.mime)) return this.fetch(info)
    let pending = this.cache.get(coreKey)
    if (!pending) {
      pending = this.fetch(info)
      this.cache.set(coreKey, pending)
      pending.catch(() => this.cache.delete(coreKey)) // a failure (sender offline) can be retried
    }
    return pending
  }

  private async fetch(info: SharedFile): Promise<Buffer> {
    const parts: Buffer[] = []
    for await (const block of this.blocks(info)) parts.push(block)
    return Buffer.concat(parts)
  }

  // "Download": the blocks go straight into the user's file, any size (a failed transfer leaves no half file)
  async saveTo(coreKey: string, filePath: string): Promise<void> {
    const info = knownFiles.get(coreKey)
    if (!info) throw new Error(t('err.fileUnknown'))
    const handle = await open(filePath, 'w')
    try {
      for await (const block of this.blocks(info)) await handle.write(block)
      await handle.close()
    } catch (err) {
      await handle.close().catch(() => {})
      await rm(filePath, { force: true }).catch(() => {})
      throw err
    }
  }

  // The blocks of a file, in order, checked against what the message announced (the progress is reported on the way)
  private async *blocks(info: SharedFile): AsyncGenerator<Buffer> {
    const core = this.store.get({ key: b4a.from(info.core, 'hex'), valueEncoding: 'binary' })
    await core.ready()
    const expected = Math.ceil(info.size / CHUNK)

    // We wait for the sender (the log's length is announced when we are connected to them)
    const start = Date.now()
    while (core.length < expected) {
      if (Date.now() - start > FETCH_TIMEOUT) throw new Error(t('err.fileUnavailable'))
      await core.update({ wait: false }).catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
    }
    if (core.length !== expected) throw new Error(t('err.fileCorrupt')) // longer than declared: refused

    // All the blocks are requested at once: asking them one by one would wait a network round trip per 64 KB
    const range = core.download({ start: 0, end: expected })
    const step = Math.max(1, Math.floor(expected / PROGRESS_STEPS))
    let total = 0
    try {
      for (let i = 0; i < expected; i++) {
        // A block that never comes (sender gone offline, or the file was freed): the usual message, not Hypercore's
        const block: Buffer = await core.get(i, { timeout: FETCH_TIMEOUT }).catch(() => {
          throw new Error(t('err.fileUnavailable'))
        })
        total += block.length
        if (total > info.size || block.length > CHUNK) throw new Error(t('err.fileCorrupt'))
        if ((i + 1) % step === 0 || i + 1 === expected) this.onProgress(info.core, i + 1, expected)
        yield block
      }
    } finally {
      range.destroy()
    }
    if (total !== info.size) throw new Error(t('err.fileCorrupt'))
  }

  // A RECEIVED file whose bytes now live elsewhere (saved by the user, or read by the player): its blocks are
  // freed. Never my own file: its log is the original, the others still download it from me.
  async releaseCopy(coreKey: string): Promise<void> {
    const core = this.store.get({ key: b4a.from(coreKey, 'hex'), valueEncoding: 'binary' })
    await core.ready()
    if (!core.writable) await this.release(coreKey)
  }

  // Audio for the chat player: only if the real bytes are audio (the declared type is never trusted)
  async audioBytes(coreKey: string): Promise<{ mime: string; bytes: Buffer }> {
    const info = knownFiles.get(coreKey)
    if (!info || !AUDIO_MIMES.includes(info.mime)) throw new Error(t('err.fileNotAudio'))
    const bytes = await this.read(coreKey)
    const mime = sniffMime(bytes)
    if (!mime || !AUDIO_MIMES.includes(mime)) throw new Error(t('err.fileNotAudio'))
    return { mime, bytes }
  }

  // Frees the disk space used by a file's blocks (after a download the user's own copy is the one that counts,
  // and when an image has expired). The log stays known: if the sender is online it can be fetched again.
  async release(coreKey: string): Promise<void> {
    this.cache.delete(coreKey)
    const core = this.store.get({ key: b4a.from(coreKey, 'hex'), valueEncoding: 'binary' })
    await core.ready()
    if (core.length > 0) await core.clear(0, core.length).catch(() => {})
  }

  // Image ready to display: only after checking the real type and the dimensions (decompression bomb)
  async imageDataUrl(coreKey: string): Promise<string> {
    const info = knownFiles.get(coreKey)
    if (!info || !IMAGE_MIMES.includes(info.mime)) throw new Error(t('err.fileNotImage'))
    const bytes = await this.read(coreKey)
    const mime = sniffMime(bytes)
    const size = imageSize(bytes)
    if (!mime || !IMAGE_MIMES.includes(mime) || !size || size.w < 1 || size.h < 1 || size.w * size.h > MAX_IMAGE_PIXELS) {
      throw new Error(t('err.fileNotImage'))
    }
    return `data:${mime};base64,${bytes.toString('base64')}`
  }
}
