//* Memory of each window's position/size (windowState.json file)
// Key = logical id of the window ('home', 'chat:<key>'): each conversation
// reopens where it was left.
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface SavedState {
  bounds: Rectangle
  maximized: boolean
}

let states: Record<string, SavedState> | null = null

// Path computed at the last moment: userData depends on the --profile chosen at startup
const file = (): string => join(app.getPath('userData'), 'windowState.json')

const load = (): Record<string, SavedState> => {
  if (states) return states
  try {
    states = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    states = {} // first launch or corrupted file: we start from scratch
  }
  return states!
}

//& Is the saved position still visible?
// (screen unplugged, resolution changed… otherwise the window would open out of view)
const isVisible = (b: Rectangle): boolean =>
  screen.getAllDisplays().some(({ workArea: w }) => {
    // At least 100 × 50 px of the window must fall within the usable area of a screen
    const overlapX = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x)
    const overlapY = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y)
    return overlapX >= 100 && overlapY >= 50
  })

export const getSavedState = (id: string): SavedState | undefined => {
  const saved = load()[id]
  return saved && isVisible(saved.bounds) ? saved : undefined
}

//& Session: small "already seen" flags (e.g. the tip about the icon next to the clock)
// (at startup only the home window opens: conversations are not restored)
interface Session {
  trayHintShown: boolean
}

const sessionFile = (): string => join(app.getPath('userData'), 'session.json')

export const loadSession = (): Session => {
  try {
    return { trayHintShown: false, ...JSON.parse(readFileSync(sessionFile(), 'utf8')) }
  } catch {
    return { trayHintShown: false }
  }
}

export const saveSession = (patch: Partial<Session>): void => {
  try {
    writeFileSync(sessionFile(), JSON.stringify({ ...loadSession(), ...patch }, null, 2))
  } catch (err) {
    console.error('session: write failed', err)
  }
}

// To call on the 'close' event (the window still exists at that moment)
export const saveState = (id: string, win: BrowserWindow): void => {
  // getNormalBounds: the "non-maximized" size, to restore correctly afterwards
  load()[id] = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
  try {
    // Synchronous write: small file, and the app may quit right afterwards
    writeFileSync(file(), JSON.stringify(states, null, 2))
  } catch (err) {
    console.error('windowState: write failed', err)
  }
}
