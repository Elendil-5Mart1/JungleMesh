//* Input area: Enter sends, Shift+Enter inserts a line break (like Discord)
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

// Loaded on first opening: the emoji data is heavy and rarely needed at startup
const EmojiPicker = lazy(() => import('./EmojiPicker'))

interface ComposerProps {
  disabled: boolean
  placeholder: string
  // Text and staged attachments (sent together, like Discord)
  onSend: (text: string, files: File[]) => Promise<void>
  attachable?: boolean // shows the paperclip and accepts pasted / dropped files
}

const MAX_FILES = 5 // staged at once
const MAX_FILE_SIZE = 25 * 1024 * 1024 // same limit as the main process, checked early to tell the user right away

export const Composer = ({ disabled, placeholder, onSend, attachable }: ComposerProps) => {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [staged, setStaged] = useState<File[]>([]) // attachments waiting for the message to be sent
  const [stageError, setStageError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // Previews of the staged files (an object URL per image, released when the list changes)
  const previews = useMemo(() => staged.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [staged])
  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews])

  const stage = (files: File[]): void => {
    if (!attachable || disabled || files.length === 0) return
    const tooBig = files.find((f) => f.size > MAX_FILE_SIZE)
    setStageError(tooBig ? t('err.fileTooBig', { max: MAX_FILE_SIZE / 1024 / 1024 }) : files.some((f) => f.size === 0) ? t('err.fileEmpty') : '')
    const ok = files.filter((f) => f.size > 0 && f.size <= MAX_FILE_SIZE)
    setStaged((prev) => [...prev, ...ok].slice(0, MAX_FILES))
    inputRef.current?.focus()
  }

  const submit = async (): Promise<void> => {
    if (!text.trim() && staged.length === 0) return
    try {
      await onSend(text, staged)
      setText('') // cleared only if sending succeeded: we do not lose a long message
      setStaged([])
    } catch {
      // the error is already displayed by the parent, we just keep the text
    }
  }

  // Image pasted from the clipboard, or file(s) dropped on the input
  const pasteFiles = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...e.clipboardData.files]
    if (!attachable || disabled || files.length === 0) return
    e.preventDefault() // a pasted picture is staged, not typed
    stage(files)
  }
  const dropFiles = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    stage([...e.dataTransfer.files])
  }
  const pickFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    stage([...(e.target.files ?? [])])
    e.target.value = '' // the same file can be picked again
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
    <div className="composer" ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
      {emojiOpen && (
        <div className="composer__emoji">
          <Suspense fallback={null}>
            <EmojiPicker onPick={insertEmoji} />
          </Suspense>
        </div>
      )}
      {staged.length > 0 && (
        <div className="composer__staged">
          {staged.map((file, i) => (
            <div key={`${file.name}-${i}`} className="composer__chip">
              {previews[i] ? <img src={previews[i]!} alt="" /> : <span aria-hidden>📄</span>}
              <span className="composer__chip-name" title={file.name}>
                {file.name}
              </span>
              <button
                type="button"
                className="composer__chip-remove"
                title={t('composer.removeFile')}
                onClick={() => setStaged(staged.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {stageError && <p className="composer__error">{stageError}</p>}
      <div className="composer__field">
        <textarea
          ref={inputRef}
          className="composer__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={pasteFiles}
          placeholder={placeholder}
          disabled={disabled}
          rows={Math.min(8, text.split('\n').length)}
        />
        {attachable && (
          <button
            type="button"
            className="composer__attach-btn"
            title={t('composer.attach')}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
            </svg>
          </button>
        )}
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
        <button
          type="button"
          className="composer__send-btn"
          title={t('composer.send')}
          disabled={disabled || (!text.trim() && staged.length === 0)}
          onClick={() => void submit()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M5 4.5 20 12 5 19.5l2.2-7.5z" />
          </svg>
        </button>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={pickFiles} />
    </div>
  )
}
