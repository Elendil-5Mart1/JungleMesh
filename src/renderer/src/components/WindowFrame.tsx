//* Frame shared by all windows: our own title bar, chamfered bottom-right corner,
// resize handles. The Electron window no longer has a Windows frame (frame: false).
import { useEffect, useState, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Edges and corners that can be grabbed to resize (n = north, se = south-east…)
const GRIPS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// The title comes from the page's <title>: the views already change it with document.title
const useDocumentTitle = (): string => {
  const [title, setTitle] = useState(document.title)
  useEffect(() => {
    const el = document.querySelector('title')
    if (!el) return
    const observer = new MutationObserver(() => setTitle(document.title))
    observer.observe(el, { childList: true })
    return () => observer.disconnect()
  }, [])
  return title
}

// A handle: we remember the mouse start point and send the movement to the main process
const startResize = (edge: string, e: PointerEvent<HTMLElement>): void => {
  e.preventDefault()
  const target = e.currentTarget
  target.setPointerCapture(e.pointerId) // keeps following the mouse even outside the window
  const [startX, startY] = [e.screenX, e.screenY]
  window.api.windowResizeStart()
  const move = (ev: globalThis.PointerEvent): void =>
    window.api.windowResize(edge, ev.screenX - startX, ev.screenY - startY)
  const stop = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', stop)
    target.removeEventListener('pointercancel', stop)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
}

interface WindowFrameProps {
  children: ReactNode
  canMinimize?: boolean // home window only; the other windows only have "close"
  kind?: string // 'chat': the bar carries the friend's name; 'room': empty bar (the room has its own header)
}

export const WindowFrame = ({ children, canMinimize = false, kind }: WindowFrameProps) => {
  const { t } = useTranslation()
  const title = useDocumentTitle()

  return (
    <div className="frame">
      <header className={`titlebar ${kind ? `titlebar--${kind}` : ''}`}>
        {!kind && <span className="titlebar__logo" aria-hidden />}
        <span className="titlebar__title">{kind === 'room' ? '' : title}</span>
        <div className="titlebar__buttons">
          {canMinimize && (
            <button
              type="button"
              className="titlebar__btn"
              aria-label={t('window.minimize')}
              onClick={() => window.api.windowMinimize()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M2 6h8" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="titlebar__btn titlebar__btn--close"
            aria-label={t('common.close')}
            onClick={() => window.api.windowClose()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      </header>

      <div className="frame__body">{children}</div>

      {/* Chamfer line: same color and thickness (1 px) as the border, shifted inwards */}
      <svg className="frame__corner" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <line x1="20.5" y1="-1.2" x2="-1.2" y2="20.5" stroke="currentColor" strokeWidth="1" />
      </svg>
      {GRIPS.map((edge) => (
        <span key={edge} className={`grip grip--${edge}`} onPointerDown={(e) => startResize(edge, e)} aria-hidden />
      ))}
    </div>
  )
}
