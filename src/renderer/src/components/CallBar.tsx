//* Call strip at the bottom of a private conversation, BEFORE the call: call / video call / join.
// During the call, the participants and the buttons are in the stage at the top (CallStage in ChatView).
import { useTranslation } from 'react-i18next'
import type { Friend } from '../../../shared/types'
import type { useVoice } from '@/voice/useVoice'
import { Icon } from '@/components/Icon'

interface CallBarProps {
  friend: Friend
  voice: ReturnType<typeof useVoice>
}

export const CallBar = ({ friend, voice }: CallBarProps) => {
  const { t } = useTranslation()
  const inCall = voice.activeChan === 'dm'
  const live = inCall && voice.status?.phase === 'live'
  const friendInCall = friend.call.includes(friend.key)

  // Call in progress: only an error remains to show here (camera refused…), the rest is in the stage
  if (live) return voice.error ? <div className="callbar"><span className="callbar__error">{voice.error}</span></div> : null
  // Nothing to show: not in a call, and the friend is not available
  if (!inCall && friend.status !== 'accepted') return null

  return (
    <div className={`callbar ${friendInCall && !inCall ? 'callbar--ringing' : ''}`}>
      <span className="callbar__who">
        {inCall ? t('room.connecting') : friendInCall ? t('call.incoming', { name: friend.name }) : ''}
      </span>
      <button
        type="button"
        className="voice__btn voice__btn--join"
        disabled={inCall || !friend.online}
        title={friend.online ? undefined : t('call.offline', { name: friend.name })}
        onClick={() => void voice.join('dm')}
      >
        {friendInCall ? t('call.join') : t('call.start')}
      </button>
      {/* Video call: same as Call, with the camera on right away */}
      <button
        type="button"
        className="voice__btn voice__btn--join voice__btn--icon"
        disabled={inCall || !friend.online}
        title={friend.online ? t('call.video') : t('call.offline', { name: friend.name })}
        aria-label={t('call.video')}
        onClick={() => void voice.join('dm', true)}
      >
        <Icon name="camera" />
      </button>
      {voice.error && <span className="callbar__error">{voice.error}</span>}
    </div>
  )
}
