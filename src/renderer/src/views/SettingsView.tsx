//* User settings window, organized by categories like on Discord
import { useEffect, useState } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { Avatar } from '@/components/Avatar'
import { Toggle } from '@/components/Toggle'
import { AudioSettings } from '@/components/AudioSettings'
import { PrivacySettings } from '@/components/PrivacySettings'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'

const EMPTY: never[] = []

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
                    onBlur={(e) => void window.api.setName(e.target.value)}
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
