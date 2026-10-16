//* Window manager: one "home" window + one window per conversation (DM or room)
import { app, BrowserWindow, dialog, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'
import { getSavedState, loadSession, saveSession, saveState } from './windowState'

// logical id ('home', 'chat:<key>') → open window
const windows = new Map<string, BrowserWindow>()

// Notified on every open / close / hide (to highlight the friend or room in the home window)
let onVisibleChange: (ids: string[]) => void = () => {}
export const watchVisibleWindows = (cb: (ids: string[]) => void): void => {
  onVisibleChange = cb
}

interface OpenOptions {
  id: string
  route: string // part after the #: the React view to display
  width: number // default size, if no position was remembered
  height: number
  title: string // also the taskbar label: every window has its own taskbar button
}

//& Placement: a new window must not cover another one
const GAP = 8 // gap left between two windows
const STEP = 24 // step of the search for a free spot

const overlaps = (a: Rectangle, b: Rectangle): boolean =>
  a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x && a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y

// Returns `wanted` if it is free, otherwise the nearest free spot on the same screen.
// No free spot (screen full): we keep the requested position rather than moving it at random.
const freeSpot = (wanted: Rectangle): Rectangle => {
  const others = allWindows()
    .filter((w) => w.isVisible() && !w.isMinimized())
    .map((w) => w.getBounds())
  if (!others.some((o) => overlaps(wanted, o))) return wanted

  const area = screen.getDisplayMatching(wanted).workArea
  let best: Rectangle | null = null
  let bestDistance = Infinity
  for (let y = area.y; y + wanted.height <= area.y + area.height; y += STEP) {
    for (let x = area.x; x + wanted.width <= area.x + area.width; x += STEP) {
      const candidate = { ...wanted, x, y }
      if (others.some((o) => overlaps(candidate, o))) continue
      const distance = Math.hypot(x - wanted.x, y - wanted.y)
      if (distance < bestDistance) [best, bestDistance] = [candidate, distance]
    }
  }
  return best ?? wanted
}

// Asks for confirmation showing the real address, then opens in the browser (http/https only)
const confirmOpenLink = async (win: BrowserWindow, raw: string): Promise<void> => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Open in browser', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Open link',
    message: `Open this link in your browser?`,
    detail: `${url.hostname}\n\n${url.href.slice(0, 300)}\n\nOnly open links you trust.`
  })
  if (response === 0) void shell.openExternal(url.href)
}

//& UI zoom: Ctrl + / Ctrl - / Ctrl 0, same level in every window, remembered
// (the windows have no menu, so Chromium's built-in shortcuts do not exist: we catch the keys ourselves)
const ZOOM_STEP = 0.5 // one step ≈ +20 %
const ZOOM_MIN = -3
const ZOOM_MAX = 4
let zoomLevel: number | null = null

const currentZoom = (): number => (zoomLevel ??= loadSession().zoom ?? 0)

const changeZoom = (next: number): void => {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
  saveSession({ zoom: zoomLevel })
  for (const w of windows.values()) if (!w.isDestroyed()) w.webContents.setZoomLevel(zoomLevel)
}

export const openWindow = ({
  id,
  route,
  width,
  height,
  title
}: OpenOptions): BrowserWindow => {
  // Already open? We bring it to the foreground instead of creating a second one
  const existing = windows.get(id)
  if (existing && !existing.isDestroyed()) {
    if (!existing.isVisible()) existing.show()
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }

  const saved = getSavedState(id)

  // Wanted position: the one from last time, otherwise the center of the primary screen
  const area = screen.getPrimaryDisplay().workArea
  const bounds = freeSpot({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    ...saved?.bounds // position/size from last time (overrides the default values)
  })

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 300,
    title,
    // Dev only: the packaged app takes its icon from the exe / .desktop file, `npm run dev` runs the generic electron.exe
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build/icon.png') }),
    show: false, // shown once ready (no visual jump)
    // Window without the Windows frame: the title bar, buttons and chamfered corner are drawn by the app.
    // `transparent` lets the desktop show through the cut corner; resizing goes through our handles.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    maximizable: false, // "maximize" makes no sense here
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security: the page has no access to Node, only to window.api
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged, // no developer tools in the installed app (anti "paste this in the console")
      webviewTag: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.on('did-finish-load', () => win.webContents.setZoomLevel(currentZoom()))
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
    if (input.key === '+' || input.key === '=') changeZoom(currentZoom() + ZOOM_STEP)
    else if (input.key === '-' || input.key === '_') changeZoom(currentZoom() - ZOOM_STEP)
    else if (input.key === '0') changeZoom(0)
    else return
    e.preventDefault()
  })

  // A link clicked in a message opens in the browser, never in the app
  // …after confirmation: a link's text can lie about its real destination (phishing)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void confirmOpenLink(win, url)
    return { action: 'deny' }
  })
  // And we forbid any navigation of the window itself away from the app (including redirects)
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-redirect', (e) => e.preventDefault())
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())

  // In dev: Vite server (hot reload). In prod: built file.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${route}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }

  windows.set(id, win)
  win.on('close', () => saveState(id, win))
  win.on('closed', () => {
    windows.delete(id)
    onVisibleChange(visibleWindowIds())
  })
  win.on('show', () => onVisibleChange(visibleWindowIds()))
  win.on('hide', () => onVisibleChange(visibleWindowIds()))
  return win
}

export const getWindow = (id: string): BrowserWindow | undefined => {
  const win = windows.get(id)
  return win && !win.isDestroyed() ? win : undefined
}

// The reverse path: which logical window is this? (useful on focus events)
export const getWindowId = (win: BrowserWindow): string | undefined => {
  for (const [id, w] of windows) if (w === win) return id
  return undefined
}

// ids of the windows actually on screen (neither closed nor hidden)
export const visibleWindowIds = (): string[] =>
  [...windows.entries()].filter(([, w]) => !w.isDestroyed() && w.isVisible()).map(([id]) => id)

export const allWindows = (): BrowserWindow[] => [...windows.values()].filter((w) => !w.isDestroyed())

// Sends an event to all open windows (each one filters what concerns it)
export const broadcast = (channel: string, ...args: unknown[]): void => {
  for (const win of allWindows()) win.webContents.send(channel, ...args)
}
