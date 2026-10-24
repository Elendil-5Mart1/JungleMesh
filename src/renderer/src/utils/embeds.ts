//* Links that can be played inside the app (YouTube, SoundCloud…): link of a message → address of the player
// Pure address work, nothing is fetched here: the player itself only loads when the user asks for it
// (or when "load players automatically" is on). Each player domain must also be allowed in the CSP
// (frame-src, renderer/index.html), and YouTube needs a Referer (main/index.ts).
// Vimeo is left out: its player shows the poster but refuses to play in Electron ("unsupported browser").

export type EmbedProvider = 'youtube' | 'soundcloud' | 'spotify' | 'mixcloud'

export interface Embed {
  provider: EmbedProvider
  url: string // the link as written in the message
  src: string // address of the player (iframe)
  autoplay: string // parameter added when the user clicked "play" ('' = the player has none)
  height: number // fixed height in px; 0 = video, sized by its aspect ratio
  vertical?: boolean // YouTube Shorts: 9:16 instead of 16:9
}

// Names shown on the card (brands: not translated)
export const PROVIDER_NAMES: Record<EmbedProvider, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  mixcloud: 'Mixcloud'
}

// Above that, a message full of links would become a wall of players
const MAX_EMBEDS = 3

//& YouTube
const YT_ID = /^[\w-]{11}$/
// Start time: ?t=90, ?t=1m30s, ?t=1h2m3s, ?start=90
const ytStart = (u: URL): number => {
  const raw = u.searchParams.get('t') ?? u.searchParams.get('start') ?? ''
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

const youtube = (u: URL, host: string): Embed | null => {
  const path = u.pathname.split('/').filter(Boolean)
  let id: string | null = null
  let vertical = false
  if (host === 'youtu.be') id = path[0] ?? null
  else if (path[0] === 'watch') id = u.searchParams.get('v')
  else if (path[0] === 'shorts' || path[0] === 'live' || path[0] === 'embed') {
    id = path[1] ?? null
    vertical = path[0] === 'shorts'
  } else if (path[0] === 'playlist') {
    const list = u.searchParams.get('list')
    if (!list || !/^[\w-]+$/.test(list)) return null
    const src = `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`
    return { provider: 'youtube', url: u.href, src, autoplay: 'autoplay=1', height: 0 }
  }
  if (!id || !YT_ID.test(id)) return null
  // youtube-nocookie: same player, but YouTube does not set its tracking cookies before playback
  const start = ytStart(u)
  const src = `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ''}`
  return { provider: 'youtube', url: u.href, src, autoplay: 'autoplay=1', height: 0, vertical }
}

//& SoundCloud: the widget takes the public link of the track as is, no ID needed
// Pages of a profile that are not something to play
const SC_NOT_TRACK = new Set(['tracks', 'albums', 'popular-tracks', 'reposts', 'likes', 'followers', 'following', 'comments'])
const SC_NOT_USER = new Set(['discover', 'search', 'stream', 'you', 'upload', 'pages', 'charts', 'terms-of-use', 'settings', 'messages', 'notifications'])

const soundcloud = (u: URL): Embed | null => {
  const path = u.pathname.split('/').filter(Boolean)
  if (!path[0] || SC_NOT_USER.has(path[0])) return null
  const set = path.length === 3 && path[1] === 'sets'
  const track = path.length === 2 && !SC_NOT_TRACK.has(path[1]) && path[1] !== 'sets'
  if (!set && !track) return null
  const link = encodeURIComponent(`https://soundcloud.com/${path.join('/')}`)
  const src = `https://w.soundcloud.com/player/?url=${link}&color=%231fd1c8&visual=false&show_comments=false`
  // No autoplay: with auto_play=true the widget shows a "discover more on SoundCloud" screen instead of the track
  return { provider: 'soundcloud', url: u.href, src, autoplay: '', height: set ? 350 : 166 }
}

//& Spotify: 30-second previews without an account, full tracks if logged in to Spotify in the player
const SPOTIFY_TYPES = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist'])

const spotify = (u: URL): Embed | null => {
  const path = u.pathname.split('/').filter(Boolean)
  if (path[0]?.startsWith('intl-')) path.shift() // open.spotify.com/intl-fr/track/…
  const [type, id] = path
  if (!type || !SPOTIFY_TYPES.has(type) || !id || !/^[A-Za-z0-9]{22}$/.test(id)) return null
  const short = type === 'track' || type === 'episode'
  return { provider: 'spotify', url: u.href, src: `https://open.spotify.com/embed/${type}/${id}`, autoplay: '', height: short ? 152 : 352 }
}

//& Mixcloud: mixcloud.com/<user>/<show>/
const MIXCLOUD_NOT_USER = new Set(['discover', 'upload', 'live', 'select', 'search', 'settings', 'dashboard', 'categories', 'tag'])

const mixcloud = (u: URL): Embed | null => {
  const path = u.pathname.split('/').filter(Boolean)
  if (path.length !== 2 || MIXCLOUD_NOT_USER.has(path[0])) return null
  const feed = encodeURIComponent(`/${path[0]}/${path[1]}/`)
  // (without the final slash: with it, the widget redirects to this address)
  const src = `https://player-widget.mixcloud.com/widget/iframe?hide_cover=1&light=0&feed=${feed}`
  return { provider: 'mixcloud', url: u.href, src, autoplay: 'autoplay=1', height: 120 }
}

//& One link → its player (or null: not a playable link)
export const embedOf = (link: string): Embed | null => {
  let u: URL
  try {
    u = new URL(link)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^(www|m)\./, '')
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') return youtube(u, host)
  if (host === 'soundcloud.com') return soundcloud(u)
  if (host === 'open.spotify.com') return spotify(u)
  if (host === 'mixcloud.com') return mixcloud(u)
  return null
}

//& Every playable link of a message, in order, without duplicates
export const embedsOf = (text: string): Embed[] => {
  // Links written as code are examples, not something to play
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const found: Embed[] = []
  for (const [raw] of prose.matchAll(/https?:\/\/[^\s<>"'`()[\]]+/g)) {
    const embed = embedOf(raw.replace(/[.,;:!?*_~]+$/, '')) // end of the sentence or markdown emphasis, not the link
    if (embed && !found.some((e) => e.src === embed.src)) found.push(embed)
    if (found.length === MAX_EMBEDS) break
  }
  return found
}
