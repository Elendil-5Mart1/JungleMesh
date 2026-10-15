//* Private conversation window with a friend
import { useEffect, useState } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { MessageList, type Author } from '@/components/MessageList'
import { Composer } from '@/components/Composer'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'

const EMPTY: never[] = [] // stable reference: avoids an infinite re-render with Zustand

export const ChatView = ({ friendKey }: { friendKey: string }) => {
  const { t } = useTranslation()
  const me = useCoreStore((s) => s.me)
  const friend = useCoreStore((s) => s.friends?.find((f) => f.key === friendKey))
  const messages = useCoreStore((s) => s.messages[friendKey] ?? EMPTY)
  const setHistory = useCoreStore((s) => s.setHistory)

  const [error, setError] = useState('')

  // On load: we fetch the history already received by the core
  useEffect(() => {
    void window.api.getHistory(friendKey).then((list) => setHistory(friendKey, list))
  }, [friendKey, setHistory])

  // The window title (Windows bar) follows the friend's name
  useEffect(() => {
    if (friend) document.title = friend.name
  }, [friend?.name])

  const send = async (text: string): Promise<void> => {
    try {
      await window.api.send(friendKey, text)
      setError('')
    } catch (err) {
      setError(cleanError(err))
      throw err // the Composer then keeps the typed text
    }
  }

  // Author of a message: me or the friend (name + avatar)
  const author = (from: string): Author =>
    from === me?.publicKey
      ? { name: me.name, avatar: me.avatar }
      : { name: friend?.name ?? '?', avatar: friend?.avatar ?? null }

  return (
    <div className="chat">
      <MessageList messages={messages} myKey={me?.publicKey} author={author} />

      {error && <p className="chat__error">{error}</p>}
      <Composer
        disabled={!friend}
        placeholder={
          friend?.online
            ? t('chat.sendTo', { name: friend.name })
            : t('chat.offline', { name: friend?.name ?? t('chat.friend') })
        }
        onSend={send}
      />
    </div>
  )
}
