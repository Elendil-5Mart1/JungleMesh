//* Buttons of a call in progress: microphone, sound, camera, screen sharing, video diagnostic, leave
// Shared by the voice channels and the private calls.
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { useVoice } from '@/voice/useVoice'
import { ScreenPicker } from '@/components/ScreenPicker'
import { Icon } from '@/components/Icon'

interface CallControlsProps {
  voice: ReturnType<typeof useVoice>
  showStats: boolean
  onToggleStats: () => void
  before?: ReactNode // extra element at the start of the row (e.g. the friend's volume in a private call)
}

export const CallControls = ({ voice, showStats, onToggleStats, before }: CallControlsProps) => {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const status = voice.status
  if (!status) return null

  return (
    <div className="voice__controls">
      {before}
      <button
        type="button"
        className={`voice__btn ${status.muted ? 'voice__btn--off' : ''}`}
        title={status.muted ? t('room.unmute') : t('room.mute')}
        onClick={() => voice.session.current?.setMuted(!status.muted)}
      >
        <Icon name={status.muted ? 'micOff' : 'mic'} />
      </button>
      <button
        type="button"
        className={`voice__btn ${status.deafened ? 'voice__btn--off' : ''}`}
        title={status.deafened ? t('room.undeafen') : t('room.deafen')}
        onClick={() => voice.session.current?.setDeafened(!status.deafened)}
      >
        <Icon name={status.deafened ? 'headphonesOff' : 'headphones'} />
      </button>
      <button
        type="button"
        className={`voice__btn ${status.camera ? 'voice__btn--on' : ''}`}
        title={status.camera ? t('room.cameraOff') : t('room.cameraOn')}
        onClick={() => void voice.toggleCamera()}
      >
        <Icon name="camera" />
      </button>
      {/* Screen: opens the picker; while sharing, a second button stops (the first one switches source) */}
      <button
        type="button"
        className={`voice__btn ${status.screen ? 'voice__btn--on' : ''}`}
        title={status.screen ? t('room.screenSwitch') : t('room.screenOn')}
        onClick={() => setPicking(true)}
      >
        <Icon name="screen" />
      </button>
      {status.screen && (
        <button type="button" className="voice__btn voice__btn--off" title={t('room.screenOff')} onClick={voice.stopScreen}>
          {t('room.screenStop')}
        </button>
      )}
      {picking && (
        <ScreenPicker
          onClose={() => setPicking(false)}
          onPick={(id, profile, audio) => {
            setPicking(false)
            void voice.startScreen(id, profile, audio)
          }}
        />
      )}
      <button type="button" className={`voice__btn ${showStats ? 'voice__btn--on' : ''}`} title={t('room.stats')} onClick={onToggleStats}>
        <Icon name="stats" />
      </button>
      <button type="button" className="voice__btn voice__btn--leave" title={t('room.hangUp')} onClick={voice.leave}>
        {t('room.leaveCall')}
      </button>
    </div>
  )
}
