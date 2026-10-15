//* Input area: Enter sends, Shift+Enter inserts a line break (like Discord)
import { useState, type KeyboardEvent } from 'react'

interface ComposerProps {
  disabled: boolean
  placeholder: string
  onSend: (text: string) => Promise<void>
}

export const Composer = ({ disabled, placeholder, onSend }: ComposerProps) => {
  const [text, setText] = useState('')

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

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={Math.min(8, text.split('\n').length)}
      />
    </div>
  )
}
