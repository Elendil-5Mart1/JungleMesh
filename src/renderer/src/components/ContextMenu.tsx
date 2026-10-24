//* Right-click menu: a small floating panel at the cursor, closed by a click elsewhere, Escape or a scroll
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuSpot {
  x: number
  y: number
}

interface ContextMenuProps {
  spot: MenuSpot
  onClose: () => void
  children: ReactNode
  className?: string // variant (e.g. 'ctx--bare' around the emoji picker)
}

export const ContextMenu = ({ spot, onClose, children, className }: ContextMenuProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(spot)

  // Keeps the menu inside the window (it opens at the cursor, but never sticks out).
  // Measured again when its size changes: a content loaded later (emoji picker) makes it grow.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = (): void => {
      const box = el.getBoundingClientRect()
      setPos({
        x: Math.max(4, Math.min(spot.x, window.innerWidth - box.width - 4)),
        y: Math.max(4, Math.min(spot.y, window.innerHeight - box.height - 4))
      })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [spot])

  useEffect(() => {
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', onClose)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className={`ctx ${className ?? ''}`} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body
  )
}

//& Menu item. `danger` = destructive action, asks for a second click before running.
interface ItemProps {
  label: string
  confirmLabel?: string
  danger?: boolean
  onSelect: () => void
}

export const MenuItem = ({ label, confirmLabel, danger, onSelect }: ItemProps) => {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      className={`ctx__item ${danger ? 'ctx__item--danger' : ''}`}
      onClick={() => {
        if (danger && confirmLabel && !armed) return setArmed(true)
        onSelect()
      }}
    >
      {armed && confirmLabel ? confirmLabel : label}
    </button>
  )
}
