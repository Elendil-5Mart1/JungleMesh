//* Landing page: fonts, styles, and download buttons that point straight at the latest release's files
// Without JavaScript (or if GitHub does not answer), every button keeps its fallback link: the releases page.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import './scss/main.scss'

const REPO = 'Elendil-5Mart1/JungleMesh'

//& Which file of a release is which button (names written by electron-builder and the Android build)
const ASSETS = {
  windows: /^JungleMesh-Setup-[\d.]+\.exe$/,
  deb: /\.deb$/,
  appimage: /\.AppImage$/,
  android: /-android-arm64\.apk$/,
  macArm: /-arm64\.dmg$/,
  macIntel: /-x64\.dmg$/
}

//& Visitor's system: what the big button of the top of the page offers
// Android before Linux: an Android browser also says "Linux"
const detectOs = () => {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'other'
}

// Hero button: label and file for each system (null = send the visitor to the download section)
const HERO = {
  windows: { label: 'Download for Windows', asset: 'windows' },
  android: { label: 'Download for Android', asset: 'android' },
  linux: { label: 'Download for Linux (.deb)', asset: 'deb' },
  mac: { label: 'macOS builds (experimental)', asset: null },
  ios: { label: 'Not on iPhone yet: other platforms', asset: null },
  other: { label: 'Download', asset: null }
}

const formatSize = (bytes) => `${Math.round(bytes / 1_000_000)} MB`

//& Latest release, read from the public GitHub API (no token: 60 requests per hour per visitor, plenty)
const latestRelease = async () => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  return res.json()
}

const setup = async () => {
  const os = detectOs()
  const hero = HERO[os]
  const heroLink = document.querySelector('[data-hero-download]')
  document.querySelector('[data-hero-label]').textContent = hero.label
  if (!hero.asset) heroLink.href = '#download'
  // The visitor's own platform comes first in the download section
  document.querySelector(`.dl[data-os="${os}"]`)?.classList.add('dl--current')

  let release
  try {
    release = await latestRelease()
  } catch {
    return // the links stay on the releases page
  }

  // Each button gets its file and its size
  const files = {}
  for (const [key, pattern] of Object.entries(ASSETS)) {
    const asset = release.assets.find((a) => pattern.test(a.name))
    if (asset) files[key] = asset
  }
  for (const link of document.querySelectorAll('[data-asset]')) {
    const asset = files[link.dataset.asset]
    if (!asset) continue
    link.href = asset.browser_download_url
    const size = link.querySelector('[data-size]')
    if (size) size.textContent = formatSize(asset.size)
  }
  if (hero.asset && files[hero.asset]) heroLink.href = files[hero.asset].browser_download_url

  // Version and date, under the hero button and at the top of the download section
  const version = release.tag_name.replace(/^v/, '')
  const date = new Date(release.published_at).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })
  document.querySelector('[data-hero-meta]').textContent = `Version ${version} · Windows · Linux · Android · MIT license`
  document.querySelector('[data-release]').textContent =
    `Version ${version}, released ${date}, straight from GitHub Releases (each file's SHA-256 is listed there).`
}

setup()
