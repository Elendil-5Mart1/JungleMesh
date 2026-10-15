//* "Voice and audio" tab: choice of microphone and output, WebRTC settings, microphone test
import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { useTranslation } from 'react-i18next'
import { Toggle } from '@/components/Toggle'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

export const AudioSettings = ({ settings, onChange }: Props) => {
  const { t } = useTranslation()
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0) // 0 to 1, for the level bar
  const stopTest = useRef<(() => void) | null>(null)

  // Device names stay empty until the microphone has been allowed once:
  // we open it for a second, just to get the permission, then close it again.
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((track) => track.stop())
      } catch {
        setError(t('audio.micDenied'))
      }
      const devices = await navigator.mediaDevices.enumerateDevices()
      setInputs(devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))
      setOutputs(devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))
    }
    void load()
    return () => stopTest.current?.()
  }, [])

  // Microphone test: same settings as in a call, the bar moves when you talk
  const toggleTest = async (): Promise<void> => {
    if (testing) return stopTest.current?.()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.micId ? { exact: settings.micId } : undefined,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl
        }
      })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
        setLevel(Math.min(1, peak * 2))
      }, 60)
      stopTest.current = () => {
        clearInterval(timer)
        stream.getTracks().forEach((track) => track.stop())
        void ctx.close()
        stopTest.current = null
        setTesting(false)
        setLevel(0)
      }
      setTesting(true)
      setError('')
    } catch {
      setError(t('audio.micFailed'))
    }
  }

  return (
    <section>
      <h2>{t('settings.tabs.audio')}</h2>
      {error && <p className="home__error">{error}</p>}

      <div className="settings__field">
        <span>{t('audio.mic')}</span>
        <select value={settings.micId} onChange={(e) => onChange({ micId: e.target.value })}>
          <option value="">{t('audio.defaultMic')}</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('audio.mic')}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__field">
        <span>{t('audio.output')}</span>
        <select value={settings.speakerId} onChange={(e) => onChange({ speakerId: e.target.value })}>
          <option value="">{t('audio.defaultOutput')}</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('audio.outputFallback')}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__field">
        <span>{t('audio.test')}</span>
        <div className="settings__row">
          <button type="button" className="settings__button" onClick={() => void toggleTest()}>
            {testing ? t('audio.stopTest') : t('audio.startTest')}
          </button>
          <div className="meter" aria-hidden>
            <div className="meter__fill" style={{ width: `${level * 100}%` }} />
          </div>
        </div>
      </div>

      <h3>{t('audio.processing')}</h3>
      <p className="settings__hint">
        {t('audio.processingHint')}
      </p>
      <Toggle
        checked={settings.noiseSuppression}
        onChange={(noiseSuppression) => onChange({ noiseSuppression })}
        label={t('audio.noise')}
        hint={t('audio.noiseHint')}
      />
      <Toggle
        checked={settings.echoCancellation}
        onChange={(echoCancellation) => onChange({ echoCancellation })}
        label={t('audio.echo')}
        hint={t('audio.echoHint')}
      />
      <Toggle
        checked={settings.autoGainControl}
        onChange={(autoGainControl) => onChange({ autoGainControl })}
        label={t('audio.gain')}
        hint={t('audio.gainHint')}
      />
    </section>
  )
}
