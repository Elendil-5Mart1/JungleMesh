//* YouTube thumbnails downloaded by the SENDER, mobile version of src/main/thumbs.ts
// Done here, in React Native, because the Bare worker has no fetch: the screens download the thumbnails,
// then pass them to call('send'), and the worker validates them again (journal.ts cleanThumbs).
// Best effort: offline, YouTube slow or a removed video = the message leaves without a thumbnail.
import type { Thumbs } from '../../src/shared/types'
import { youtubeIdsOf, ytThumbUrl } from '../../src/shared/embeds'

const TIMEOUT_MS = 3000 // the message waits for its thumbnails: never long
const MAX_BYTES = 45_000 // same cap as cleanThumbs (60 000 characters of base64)

// Blob → "data:image/jpeg;base64,…" (React Native has no Buffer: FileReader does the base64)
const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

const fetchThumb = async (id: string): Promise<[string, string] | null> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ytThumbUrl(id), { signal: abort.signal })
    if (!res.ok || res.headers.get('content-type') !== 'image/jpeg') return null
    const blob = await res.blob()
    if (blob.size === 0 || blob.size > MAX_BYTES) return null
    // Some versions of FileReader label the data with the blob's type, or nothing: we write our own
    const data = await toDataUrl(blob)
    return [id, `data:image/jpeg;base64,${data.slice(data.indexOf(',') + 1)}`]
  } catch {
    return null // timeout, offline, DNS…
  } finally {
    clearTimeout(timer)
  }
}

// Thumbnails of the YouTube videos of a message (undefined: none, or none could be downloaded)
export const thumbsOf = async (text: string): Promise<Thumbs | undefined> => {
  const ids = youtubeIdsOf(text)
  if (ids.length === 0) return undefined
  const found = (await Promise.all(ids.map(fetchThumb))).filter((t): t is [string, string] => !!t)
  return found.length ? Object.fromEntries(found) : undefined
}
