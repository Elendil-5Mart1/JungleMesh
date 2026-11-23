//* Updates of the Android app from the GitHub releases (the same repository as the desktop's electron-updater)
// No auto-install: we only look for a newer release that carries an .apk, and the user downloads it in the
// browser if they want. Android then installs it OVER the current app only if it is signed with the same key,
// which is the real integrity check (as with any APK update).
// The check contacts GitHub, so GitHub sees the IP: the user can turn it off (Settings).
//
// Store build (EXPO_PUBLIC_STORE=play when building): no check at all. Google Play forbids an app
// from updating itself outside of Play, and Play already handles updates.
import { AppState } from 'react-native'
import Constants from 'expo-constants'

const REPO = 'Elendil-5Mart1/JungleMesh'
const API = `https://api.github.com/repos/${REPO}/releases?per_page=10`
const DOWNLOADS = `https://github.com/${REPO}/releases/download/` // the only links we agree to open
const FIRST_CHECK_MS = 10_000 // let the core start first
const EVERY_MS = 24 * 60 * 60 * 1000 // at most once a day when the app comes back to the foreground

export const IS_STORE_BUILD = process.env.EXPO_PUBLIC_STORE === 'play'

export interface Update {
  version: string // e.g. 0.4.0
  url: string // the .apk to download
}

interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string }[]
}

//& Versions "0.3.1", "v0.3.1" or "mobile-v0.3.1" → [0, 3, 1]
const parse = (text: string): number[] | null => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return match ? match.slice(1).map(Number) : null
}

const isNewer = (candidate: number[], current: number[]): boolean => {
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i]
  }
  return false
}

//& The newest published release that has an APK, if it is newer than this app (null otherwise)
// The releases without an APK (desktop only) are skipped: the mobile version may lag behind the desktop one.
export const findUpdate = async (): Promise<Update | null> => {
  const current = parse(Constants.expoConfig?.version ?? '')
  if (!current) return null
  const response = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) return null // offline, rate limit (60 requests/hour per IP)…: stay silent
  const releases = (await response.json()) as Release[]
  for (const release of releases) {
    if (release.draft || release.prerelease) continue
    const apks = release.assets.filter((a) => a.name.endsWith('.apk') && a.browser_download_url.startsWith(DOWNLOADS))
    // Several APKs (one per architecture): the arm64 one, which every recent phone uses
    const apk = apks.find((a) => a.name.includes('arm64')) ?? apks[0]
    const version = parse(release.tag_name)
    if (!apk || !version) continue
    return isNewer(version, current) ? { version: version.join('.'), url: apk.browser_download_url } : null
  }
  return null
}

//& Checks shortly after the start, then when the app comes back to the foreground (once a day at most)
// isEnabled is read at each check: turning the option off takes effect immediately.
export const watchUpdates = (isEnabled: () => boolean, onFound: (update: Update) => void): (() => void) => {
  if (IS_STORE_BUILD) return () => {}
  let last = 0
  const check = () => {
    if (!isEnabled() || Date.now() - last < EVERY_MS) return
    last = Date.now()
    findUpdate()
      .then((update) => update && onFound(update))
      .catch(() => {}) // no network: the next foreground after a day tries again
  }
  const timer = setTimeout(check, FIRST_CHECK_MS)
  const listener = AppState.addEventListener('change', (status) => status === 'active' && check())
  return () => {
    clearTimeout(timer)
    listener.remove()
  }
}
