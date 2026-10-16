//* Private conversation window with a friend
import { useEffect, useState } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { MessageList, type Author } from '@/components/MessageList'
import { Composer } from '@/components/Composer'
import { CallBar } from '@/components/CallBar'
import { sendMessage } from '@/utils/sendMessage'
import { useVoice } from '@/voice/useVoice'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'

const EMPTY: never[] = [] // stable reference: avoids an infinite re-render with Zustand

export const ChatView = ({ friendKey }: { friendKey: string }) => {
  const { t } = useTranslation()
  const me = useCoreStore((s) => s.me)
  const friend = useCoreStore((s) => s.friends?.find((f) => f.key === friendKey))
  const messages = useCoreStore((s) => s.messages[friendKey] ?? EMPTY)
  const settings = useCoreStore((s) => s.settings)
  const setHistory = useCoreStore((s) => s.setHistory)

  const [error, setError] = useState('')
  // 1-to-1 call: same machinery as the voice channels, with the "virtual room" shared with this friend
  const voice = useVoice(friend?.callId ?? '', me?.publicKey, friend ? { dm: friend.call } : undefined)

  // On load: we fetch the history already received by the core
  useEffect(() => {
    void window.api.getHistory(friendKey).then((list) => setHistory(friendKey, list))
  }, [friendKey, setHistory])

  // The window title (Windows bar) follows the friend's name
  useEffect(() => {
    if (friend) document.title = friend.name
  }, [friend?.name])

  const send = async (text: string, files: File[]): Promise<void> => {
    try {
      await sendMessage(friendKey, text, files)
      setError('')
    } catch (err) {
      setError(cleanError(err))
      throw err // the Composer then keeps the typed text
    }
  }

  const remove = (id: string): void => {
    void window.api.deleteMessage(friendKey, id).catch((err) => setError(cleanError(err)))
  }

  // Author of a message: me or the friend (name + avatar)
  const author = (from: string): Author =>
    from === me?.publicKey
      ? { name: me.name, avatar: me.avatar }
      : { name: friend?.name ?? '?', avatar: friend?.avatar ?? null }

  return (
    <div className="chat">
      <MessageList messages={messages} myKey={me?.publicKey} author={author} imageTtlHours={settings?.imageTtlHours} onDelete={remove} />

      {error && <p className="chat__error">{error}</p>}
      <Composer
        disabled={!friend}
        placeholder={
          friend?.online
            ? t('chat.sendTo', { name: friend.name })
            : t('chat.offline', { name: friend?.name ?? t('chat.friend') })
        }
        onSend={send}
        attachable
      />
      {friend && me && <CallBar friend={friend} myKey={me.publicKey} voice={voice} />}
    </div>
  )
}
