//* Incoming call popup (small window centered on the screen, above the others): Join / Decline.
// Opened and closed by the main process: it disappears by itself if the friend hangs up.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCoreStore } from '@/stores/useCoreStore'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'

export const IncomingCallView = ({ friendKey }: { friendKey: string }) => {
  const { t } = useTranslation()
  const friend = useCoreStore((s) => s.friends?.find((f) => f.key === friendKey))

  useEffect(() => {
    document.title = t('notif.callTitle')
  }, [t])

  // Keyboard: Enter = join, Escape = decline
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') void window.api.callAccept(friendKey)
      if (e.key === 'Escape') void window.api.callDecline(friendKey)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [friendKey])

  if (!friend) return null

  return (
    <div className="incoming">
      <div className="incoming__avatar">
        <Avatar src={friend.avatar} name={friend.name} seed={friend.key} size={72} />
      </div>
      <p className="incoming__text">
        <span className="incoming__phone">
          <Icon name="phone" size={18} />
        </span>
        {t('call.incoming', { name: friend.name })}
      </p>
      <div className="incoming__actions">
        <button type="button" className="incoming__btn incoming__btn--decline" onClick={() => void window.api.callDecline(friendKey)}>
          {t('call.decline')}
        </button>
        <button type="button" className="incoming__btn incoming__btn--join" onClick={() => void window.api.callAccept(friendKey)}>
          {t('call.join')}
        </button>
      </div>
    </div>
  )
}
