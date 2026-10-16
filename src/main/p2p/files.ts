//* Shared files and images: the bytes travel in their own Hypercore (one block = 64 KB),
// the chat message only carries a pointer to it (see SharedFile in journal.ts).
// Why a separate log: the conversation log stays small and fast to replicate, and a recipient only
// downloads the bytes when they are needed (an image being displayed, or a click on "Download").
// The same Corestore connection already replicates every log both sides have open: nothing else to set up.
import { randomUUID } from 'node:crypto'
import b4a from 'b4a'
import { t } from '../../shared/i18n'
import {
  IMAGE_MIMES,
  MAX_FILE_SIZE,
  MAX_IMAGE_PIXELS,
  imageSize,
  knownFiles,
  type SharedFile
} from './journal'

const CHUNK = 64 * 1024
const FETCH_TIMEOUT = 30_000 // ms to receive the first block (the sender may be offline)

// What the bytes really are, from their first bytes (the declared type is never trusted)
const sniffMime = (bytes: Buffer): string | null => {
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length > 6 && bytes.toString('latin1', 0, 3) === 'GIF') return 'image/gif'
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp'
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
  async publish(name: string, data: Buffer): Promise<SharedFile> {
    if (data.length < 1) throw new Error(t('err.fileEmpty'))
    if (data.length > MAX_FILE_SIZE) throw new Error(t('err.fileTooBig', { max: MAX_FILE_SIZE / 1024 / 1024 }))
    const core = this.store.get({ name: `file:${randomUUID()}`, valueEncoding: 'binary' })
    await core.ready()
    const blocks: Buffer[] = []
    for (let i = 0; i < data.length; i += CHUNK) blocks.push(data.subarray(i, i + CHUNK))
    await core.append(blocks)
    const mime = sniffMime(data) ?? 'application/octet-stream'
    return { core: b4a.toString(core.key, 'hex'), name, size: data.length, mime }
  }

  // Reads all the bytes of a file announced by a message (the progress is reported block by block).
  // Only images are kept in memory afterwards: they are displayed again and again.
  read(coreKey: string): Promise<Buffer> {
    const info = knownFiles.get(coreKey)
    if (!info) return Promise.reject(new Error(t('err.fileUnknown')))
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

    const parts: Buffer[] = []
    let total = 0
    for (let i = 0; i < expected; i++) {
      const block: Buffer = await core.get(i, { timeout: FETCH_TIMEOUT })
      total += block.length
      if (total > info.size || block.length > CHUNK) throw new Error(t('err.fileCorrupt'))
      parts.push(block)
      this.onProgress(info.core, i + 1, expected)
    }
    if (total !== info.size) throw new Error(t('err.fileCorrupt'))
    return Buffer.concat(parts)
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
