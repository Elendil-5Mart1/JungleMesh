import type { PointerEvent } from 'react'
import { useState } from 'react'

//* Resizable columns: drag handle between two panels + remembered width

// Width remembered across windows and restarts (simple convenience, never required)
export const useColumnWidth = (storageKey: string, initial: number, min: number, max: number) => {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n))
  const [width, setWidthState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return saved ? clamp(saved) : initial
    } catch {
      return initial
    }
  })

  const setWidth = (n: number, persist = false): void => {
    const next = clamp(n)
    setWidthState(next)
    if (!persist) return
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // storage unavailable: the width simply is not remembered
    }
  }

  return [width, setWidth] as const
}

interface SplitterProps {
  width: number // current width of the column being resized
  onChange: (width: number, persist?: boolean) => void
  side: 'left' | 'right' // which column the handle belongs to: a right column grows when dragged leftwards
}

export const Splitter = ({ width, onChange, side }: SplitterProps) => {
  const sign = side === 'left' ? 1 : -1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId) // keeps receiving the moves even outside the handle
    const startX = e.clientX
    const startWidth = width
    let last = startWidth

    const move = (ev: globalThis.PointerEvent): void => {
      last = startWidth + sign * (ev.clientX - startX)
      onChange(last)
    }
    const stop = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', stop)
      target.removeEventListener('pointercancel', stop)
      onChange(last, true) // saved once, at the end of the drag
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
  }

  return <div className={`splitter splitter--${side}`} role="separator" aria-orientation="vertical" onPointerDown={onPointerDown} />
}
