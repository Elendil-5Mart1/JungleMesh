//* Call strip at the top of a private conversation: start / join / hang up, mute, deafen, friend's volume
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend } from '../../../shared/types'
import type { useVoice } from '@/voice/useVoice'
import { getVoiceVolume, saveVoiceVolume } from '@/utils/voiceVolume'

interface CallBarProps {
  friend: Friend
  myKey: string
  voice: ReturnType<typeof useVoice>
}

export const CallBar = ({ friend, myKey, voice }: CallBarProps) => {
  const { t } = useTranslation()
  const [volume, setVolume] = useState(() => getVoiceVolume(friend.key))
  const inCall = voice.activeChan === 'dm'
  const friendInCall = friend.call.includes(friend.key)
  const link = voice.status?.links[friend.key]
  const speaking = voice.status?.speaking.includes(friend.key)

  const changeVolume = (value: number): void => {
    setVolume(value)
    saveVoiceVolume(friend.key, value)
    voice.session.current?.setVolume(friend.key, value)
  }

  // Nothing to show: not in a call, and the friend is not calling (or is not available)
  if (!inCall && friend.status !== 'accepted') return null

  return (
    <div className={`callbar ${friendInCall && !inCall ? 'callbar--ringing' : ''}`}>
      {inCall && voice.status?.phase === 'live' ? (
        <>
          <span className={`callbar__who ${speaking ? 'callbar__who--speaking' : ''}`}>
            🔊 {friend.name} · {t(`room.link.${link ?? 'connecting'}`)}
          </span>
          <input
            className="callbar__volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            title={t('menu.volume', { percent: Math.round(volume * 100) })}
            onChange={(e) => changeVolume(Number(e.target.value))}
          />
          <button
            type="button"
            className={`voice__btn ${voice.status.muted ? 'voice__btn--off' : ''}`}
            title={voice.status.muted ? t('room.unmute') : t('room.mute')}
            onClick={() => voice.session.current?.setMuted(!voice.status?.muted)}
          >
            {voice.status.muted ? '🔇' : '🎤'}
          </button>
          <button
            type="button"
            className={`voice__btn ${voice.status.deafened ? 'voice__btn--off' : ''}`}
            title={voice.status.deafened ? t('room.undeafen') : t('room.deafen')}
            onClick={() => voice.session.current?.setDeafened(!voice.status?.deafened)}
          >
            {voice.status.deafened ? '🙉' : '🎧'}
          </button>
          <button type="button" className="voice__btn voice__btn--leave" title={t('room.hangUp')} onClick={voice.leave}>
            {t('room.leaveCall')}
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
      {voice.error && <span className="callbar__error">{voice.error}</span>}
    </div>
  )
}
