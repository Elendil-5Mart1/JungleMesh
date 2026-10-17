//* User settings window, organized by categories like on Discord
import { useEffect, useState } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { Avatar } from '@/components/Avatar'
import { Toggle } from '@/components/Toggle'
import { Icon } from '@/components/Icon'
import { AudioSettings } from '@/components/AudioSettings'
import { PrivacySettings } from '@/components/PrivacySettings'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'
import { forgetCustomSound, playNotifSound, startRing } from '@/utils/notifSound'
import type { SoundKind, WindowMaterial } from '../../../shared/types'

const EMPTY: never[] = []
const RING_TEST_MS = 3000 // the ringtone test stops by itself
// Blur behind the windows: a Windows 11 feature (nothing on Linux)
const IS_WINDOWS = navigator.userAgent.includes('Windows')
const MATERIALS: WindowMaterial[] = ['none', 'pearl', 'acrylic']

//& Sound row: current sound (default or custom file), test, choose a file, back to default
const SoundChooser = ({ kind, file, onError }: { kind: SoundKind; file: string; onError: (msg: string) => void }) => {
  const { t } = useTranslation()
  const test = (): void => {
    const settings = useCoreStore.getState().settings
    if (kind === 'notif') return void playNotifSound(settings)
    setTimeout(startRing('incoming', settings), RING_TEST_MS)
  }
  const pick = async (): Promise<void> => {
    try {
      if (await window.api.pickSound(kind)) forgetCustomSound(kind)
      onError('')
    } catch (err) {
      onError(cleanError(err))
    }
  }
  const reset = (): void => {
    forgetCustomSound(kind)
    void window.api.resetSound(kind)
  }
  return (
    <div className="settings__sound">
      <span className="settings__sound-name" title={file}>
        {file || t('settings.soundDefault')}
      </span>
      <button type="button" onClick={test}>
        <Icon name="play" size={14} /> {t('settings.soundTest')}
      </button>
      <button type="button" onClick={() => void pick()}>
        {t('settings.soundPick')}
      </button>
      {file && (
        <button type="button" className="settings__link" onClick={reset}>
          {t('settings.soundReset')}
        </button>
      )}
    </div>
  )
}

type Tab = 'profile' | 'notifications' | 'app' | 'audio' | 'privacy'
const TABS: Tab[] = ['profile', 'notifications', 'app', 'audio', 'privacy'] // labels: settings.tabs.<id>

export const SettingsView = () => {
  const { t } = useTranslation()
  const me = useCoreStore((s) => s.me)
  const friends = useCoreStore((s) => s.friends) ?? EMPTY
  const rooms = useCoreStore((s) => s.rooms) ?? EMPTY
  const settings = useCoreStore((s) => s.settings)

  const [tab, setTab] = useState<Tab>('profile')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = t('settings.title')
  }, [t])

  if (!me || !settings) return <div className="home home--loading">{t('settings.loading')}</div>

  const set = (patch: Partial<typeof settings>): void => {
    void window.api.setSettings(patch).catch((err) => setError(cleanError(err)))
  }

  // A conversation (friend or room) is muted or unmuted
  const setMuted = (key: string, muted: boolean): void => {
    set({ muted: muted ? [...settings.muted, key] : settings.muted.filter((k) => k !== key) })
  }

  const copyCode = async (): Promise<void> => {
    await navigator.clipboard.writeText(me.inviteCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const contacts = friends.filter((f) => f.status === 'accepted')
  const myRooms = rooms.filter((r) => r.status !== 'invited')

  return (
    <div className="settings">
      <nav className="settings__nav">
        <h1 className="settings__heading">{t('settings.title')}</h1>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`settings__tab ${tab === id ? 'settings__tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {t(`settings.tabs.${id}`)}
          </button>
        ))}
      </nav>

      <main className="settings__page">
        {error && <p className="home__error">{error}</p>}

        {/*& Profile */}
        {tab === 'profile' && (
          <section>
            <h2>{t('settings.tabs.profile')}</h2>
            <div className="settings__profile">
              <Avatar
                src={me.avatar}
                name={me.name}
                seed={me.publicKey}
                size={96}
                onChange={(avatar) => window.api.setAvatar(avatar)}
              />
              <div className="settings__fields">
                <label className="settings__field">
                  <span>{t('settings.name')}</span>
                  <input
                    defaultValue={me.name}
                    maxLength={32}
                    // Only if it really changed: a new name is re-announced to every connected peer
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== me.name) void window.api.setName(name)
                    }}
                  />
                </label>
                <div className="settings__field">
                  <span>{t('settings.photo')}</span>
                  <div className="settings__row">
                    <small>{t('settings.photoHint')}</small>
                    {me.avatar && (
                      <button type="button" className="settings__link" onClick={() => void window.api.setAvatar(null)}>
                        {t('settings.remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="settings__field">
              <span>{t('settings.inviteCode')}</span>
              <p className="settings__hint">{t('settings.inviteCodeHint')}</p>
              <div className="settings__code">
                <code>{me.inviteCode}</code>
                <button type="button" onClick={copyCode}>
                  {copied ? t('settings.copied') : t('settings.copy')}
                </button>
              </div>
            </div>
          </section>
        )}

        {/*& Notifications */}
        {tab === 'notifications' && (
          <section>
            <h2>{t('settings.tabs.notifications')}</h2>
            <Toggle
              checked={settings.notifications}
              onChange={(notifications) => set({ notifications })}
              label={t('settings.toasts')}
              hint={t('settings.toastsHint')}
            />
            <Toggle
              checked={settings.flash}
              onChange={(flash) => set({ flash })}
              label={t('settings.flash')}
              hint={t('settings.flashHint')}
            />
            <Toggle
              checked={settings.notifSound}
              onChange={(notifSound) => {
                set({ notifSound })
                if (notifSound) void playNotifSound(settings) // preview when turned on
              }}
              label={t('settings.notifSound')}
              hint={t('settings.notifSoundHint')}
            />
            {settings.notifSound && <SoundChooser kind="notif" file={settings.notifSoundFile} onError={setError} />}
            <Toggle
              checked={settings.ringtone}
              onChange={(ringtone) => set({ ringtone })}
              label={t('settings.ringtone')}
              hint={t('settings.ringtoneHint')}
            />
            {settings.ringtone && <SoundChooser kind="ring" file={settings.ringtoneFile} onError={setError} />}

            <h3>{t('settings.mute')}</h3>
            <p className="settings__hint">
              {t('settings.muteHint')}
            </p>
            {myRooms.length + contacts.length === 0 && (
              <p className="settings__hint">{t('settings.noConversations')}</p>
            )}
            {myRooms.map((r) => (
              <Toggle
                key={r.key}
                checked={settings.muted.includes(r.key)}
                onChange={(muted) => setMuted(r.key, muted)}
                label={`# ${r.name}`}
              />
            ))}
            {contacts.map((f) => (
              <Toggle
                key={f.key}
                checked={settings.muted.includes(f.key)}
                onChange={(muted) => setMuted(f.key, muted)}
                label={f.name}
              />
            ))}
          </section>
        )}

        {/*& Application */}
        {tab === 'app' && (
          <section>
            <h2>{t('settings.tabs.app')}</h2>
            <Toggle
              checked={settings.launchAtStartup}
              onChange={(launchAtStartup) => set({ launchAtStartup })}
              disabled={!settings.canAutostart}
              label={t('settings.autostart')}
              hint={
                settings.canAutostart
                  ? t('settings.autostartHint')
                  : t('settings.autostartDev')
              }
            />
            <p className="settings__hint">
              {t('settings.trayHint')}
            </p>

            <h3>{t('settings.appearance')}</h3>
            <label className="settings__slider">
              <span>{t('settings.opacity')}</span>
              <input
                type="range"
                min={30}
                max={100}
                step={5}
                value={settings.windowOpacity}
                onChange={(e) => set({ windowOpacity: Number(e.target.value) })}
              />
              <output>{settings.windowOpacity} %</output>
            </label>
            <p className="settings__hint">{t('settings.opacityHint')}</p>
            {IS_WINDOWS && (
              <>
                <div className="settings__choices" role="radiogroup" aria-label={t('settings.material')}>
                  <span>{t('settings.material')}</span>
                  {MATERIALS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={settings.windowMaterial === m}
                      className={settings.windowMaterial === m ? 'settings__choice--on' : ''}
                      onClick={() => set({ windowMaterial: m })}
                    >
                      {t(`settings.materials.${m}`)}
                    </button>
                  ))}
                </div>
                <p className="settings__hint">{t('settings.materialHint')}</p>
              </>
            )}
          </section>
        )}

        {/*& Voice and audio */}
        {tab === 'audio' && <AudioSettings settings={settings} onChange={set} />}

        {/*& Privacy */}
        {tab === 'privacy' && <PrivacySettings settings={settings} onChange={set} />}
      </main>
    </div>
  )
}
