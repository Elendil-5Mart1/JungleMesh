//* YouTube thumbnails downloaded by the SENDER (0.4.1), attached to the message
// Why the sender: a recipient who displays a thumbnail straight from YouTube reveals their IP to Google
// for a video they may never watch. The sender shares the link, so they contacted YouTube anyway: they
// download the small image (mqdefault, 320×180, ~15 KB) and the recipients get it through the P2P log.
// Best effort: no network, YouTube slow or a removed video = the message leaves without a thumbnail
// (the card stays as before). Validated again by journal.ts cleanThumbs, like any received entry.
import type { Thumbs } from '../shared/types'
import { youtubeIdsOf, ytThumbUrl } from '../shared/embeds'

const TIMEOUT_MS = 3000 // the message waits for its thumbnails: never long
const MAX_BYTES = 45_000 // same cap as cleanThumbs (60 000 characters of base64)

const fetchThumb = async (id: string): Promise<[string, string] | null> => {
  try {
    // Node's fetch (not the window's session): no cookie, no Referer, nothing but the image
    const res = await fetch(ytThumbUrl(id), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
    if (!res.ok || res.headers.get('content-type') !== 'image/jpeg') return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null
    return [id, `data:image/jpeg;base64,${bytes.toString('base64')}`]
  } catch {
    return null // timeout, offline, DNS…
  }
}

// Thumbnails of the YouTube videos of a message (undefined: none, or none could be downloaded)
export const thumbsOf = async (text: string): Promise<Thumbs | undefined> => {
  const ids = youtubeIdsOf(text)
  if (ids.length === 0) return undefined
  const found = (await Promise.all(ids.map(fetchThumb))).filter((t): t is [string, string] => !!t)
  return found.length ? Object.fromEntries(found) : undefined
}
