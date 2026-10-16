//* Input area: Enter sends, Shift+Enter inserts a line break (like Discord)
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

// Loaded on first opening: the emoji data is heavy and rarely needed at startup
const EmojiPicker = lazy(() => import('./EmojiPicker'))

interface ComposerProps {
  disabled: boolean
  placeholder: string
  onSend: (text: string) => Promise<void>
}

export const Composer = ({ disabled, placeholder, onSend }: ComposerProps) => {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Click outside or Escape closes the picker
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setEmojiOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setEmojiOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [emojiOpen])

  const submit = async (): Promise<void> => {
    if (!text.trim()) return
    try {
      await onSend(text)
      setText('') // cleared only if sending succeeded: we do not lose a long message
    } catch {
      // the error is already displayed by the parent, we just keep the text
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  // Inserts the emoji at the cursor (or replaces the selection), then puts the cursor right after it
  const insertEmoji = (emoji: string): void => {
    const el = inputRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  return (
    <div className="composer" ref={wrapRef}>
      {emojiOpen && (
        <div className="composer__emoji">
          <Suspense fallback={null}>
            <EmojiPicker onPick={insertEmoji} />
          </Suspense>
        </div>
      )}
      <div className="composer__field">
        <textarea
          ref={inputRef}
          className="composer__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={Math.min(8, text.split('\n').length)}
        />
        <button
          type="button"
          className="composer__emoji-btn"
          title={t('emoji.button')}
          disabled={disabled}
          onClick={() => setEmojiOpen(!emojiOpen)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" />
            <circle cx="9" cy="10" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
            <path d="M7.8 14.2c1.1 1.8 2.5 2.6 4.2 2.6s3.1-.8 4.2-2.6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
