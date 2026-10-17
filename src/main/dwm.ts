//* Native window corners (Windows 11 only), straight from the Desktop Window Manager
// The blur material covers the whole window rectangle: the CSS chamfer cannot cut it (grey triangle),
// a window region (setShape) neither. DWM rounding is the only clip the material follows,
// so when a material is on, the windows get Windows 11's rounded corners instead of the chamfer.
// Electron does not expose this attribute on Windows: we call dwmapi.dll through koffi (FFI, prebuilt, no compilation).
// koffi is loaded on first use, on Windows only: the Linux package does not ship it at all, and the Windows
// one only keeps its win32_x64 binary (see "files" in package.json: koffi ships ~27 MB for every OS).
import type { BrowserWindow } from 'electron'

const DWMWA_WINDOW_CORNER_PREFERENCE = 33
const DWMWA_BORDER_COLOR = 34
const CORNER = { square: 1, round: 2 } // DWMWCP_DONOTROUND / DWMWCP_ROUND
const COLOR_NONE = 0xfffffffe // DWMWA_COLOR_NONE: no system outline

type SetAttribute = (hwnd: bigint, attr: number, value: Buffer, size: number) => number
let setAttribute: SetAttribute | null | undefined // undefined = not loaded yet, null = unavailable

const load = (): SetAttribute | null => {
  if (setAttribute !== undefined) return setAttribute
  try {
    const koffi = require('koffi') as typeof import('koffi')
    const dwmapi = koffi.load('dwmapi.dll')
    setAttribute = dwmapi.func(
      'long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, void *value, uint32_t size)'
    ) as SetAttribute
  } catch (err) {
    console.error('dwm: unavailable', err)
    setAttribute = null
  }
  return setAttribute ?? null
}

const setUint = (win: BrowserWindow, attr: number, value: number): void => {
  const fn = load()
  if (!fn) return
  const handle = win.getNativeWindowHandle() // HWND, as raw bytes
  const hwnd = handle.length === 8 ? handle.readBigInt64LE(0) : BigInt(handle.readInt32LE(0))
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value)
  fn(hwnd, attr, buf, 4) // fails silently before Windows 11 (unknown attribute): the corners just stay square
}

export const setRoundCorners = (win: BrowserWindow, round: boolean): void => {
  if (process.platform !== 'win32') return
  setUint(win, DWMWA_WINDOW_CORNER_PREFERENCE, round ? CORNER.round : CORNER.square)
  setUint(win, DWMWA_BORDER_COLOR, COLOR_NONE) // our own CSS border is enough
}
