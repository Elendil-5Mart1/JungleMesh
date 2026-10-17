//* "Share your screen" picker, like Discord: screens / windows with a thumbnail, quality, PC sound.
// The sources are listed by the main process (desktopCapturer): the page itself cannot see the screen.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ScreenSource } from '../../../shared/types'
import { Toggle } from '@/components/Toggle'
import { Icon } from '@/components/Icon'
import { SCREEN_AUDIO, SCREEN_PROFILES, type ScreenProfile } from '@/voice/VoiceSession'

interface ScreenPickerProps {
  onPick: (sourceId: string, profile: ScreenProfile, audio: boolean) => void
  onClose: () => void
}

// Last choices remembered (simple convenience, per window)
const PREFS_KEY = 'screen:prefs'
const loadPrefs = (): { profile: ScreenProfile; audio: boolean } => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { profile: saved.profile in SCREEN_PROFILES ? saved.profile : '1080p30', audio: saved.audio !== false }
  } catch {
    return { profile: '1080p30', audio: true }
  }
}

// Thumbnails kept alive (a game, a video moves); a listing takes ~1-2 s of the main process, so not too often
const REFRESH_MS = 5000

export const ScreenPicker = ({ onPick, onClose }: ScreenPickerProps) => {
  const { t } = useTranslation()
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [tab, setTab] = useState<ScreenSource['kind']>('window')
  const [chosen, setChosen] = useState<string | null>(null)
  const [prefs, setPrefs] = useState(loadPrefs)

  useEffect(() => {
    let alive = true
    const load = (): void =>
      void window.api
        .screenSources()
        .then((list) => alive && setSources(list))
        .catch(() => alive && setSources([]))
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // Escape closes, like the other windows of the app
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const change = (patch: Partial<typeof prefs>): void => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: choice kept until the window closes
    }
  }

  const shown = sources?.filter((s) => s.kind === tab) ?? []
  const go = (id = chosen): void => {
    if (id) onPick(id, prefs.profile, SCREEN_AUDIO && prefs.audio)
  }

  // Portal: out of the stage (its tiles are "containers", which would trap a fixed element);
  // in full screen, inside the full screen element, otherwise it would be hidden
  return createPortal(
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box picker" role="dialog" aria-label={t('screen.title')}>
        <header className="modal__header">
          <h2>{t('screen.title')}</h2>
          <button type="button" className="modal__close" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className="picker__tabs">
          {(['window', 'screen'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`picker__tab ${tab === kind ? 'picker__tab--on' : ''}`}
              onClick={() => setTab(kind)}
            >
              {t(kind === 'window' ? 'screen.windows' : 'screen.screens')}
            </button>
          ))}
        </div>

        <div className="modal__body">
          {sources === null && <p className="modal__hint">{t('screen.loading')}</p>}
          {sources !== null && shown.length === 0 && <p className="modal__hint">{t('screen.none')}</p>}
          <div className="picker__grid">
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`picker__source ${chosen === s.id ? 'picker__source--on' : ''}`}
                title={s.name}
                onClick={() => setChosen(s.id)}
                onDoubleClick={() => go(s.id)}
              >
                {s.thumbnail ? <img className="picker__thumb" src={s.thumbnail} alt="" /> : <span className="picker__thumb picker__thumb--empty" />}
                <span className="picker__name">
                  {s.icon && <img src={s.icon} alt="" />}
                  <span>{s.name}</span>
                </span>
              </button>
            ))}
          </div>

          <section className="modal__section">
            <h3>{t('screen.quality')}</h3>
            <div className="picker__profiles">
              {(Object.keys(SCREEN_PROFILES) as ScreenProfile[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`picker__profile ${prefs.profile === p ? 'picker__profile--on' : ''}`}
                  onClick={() => change({ profile: p })}
                >
                  <strong>{t(`screen.profile.${p}`)}</strong>
                  <span>{t(SCREEN_PROFILES[p].fps >= 60 ? 'screen.motion' : 'screen.detail')}</span>
                </button>
              ))}
            </div>
            <p className="modal__hint">{t('screen.qualityHint', { mbps: SCREEN_PROFILES[prefs.profile].bitrate / 1_000_000 })}</p>
          </section>

          {SCREEN_AUDIO && (
            <section className="modal__section">
              <Toggle checked={prefs.audio} onChange={(audio) => change({ audio })} label={t('screen.audio')} hint={t('screen.audioHint')} />
            </section>
          )}
        </div>

        <footer className="picker__footer">
          <button type="button" className="picker__cancel" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="picker__go" disabled={!chosen} onClick={() => go()}>
            {t('screen.go')}
          </button>
        </footer>
      </div>
    </div>,
    document.fullscreenElement ?? document.body
  )
}
