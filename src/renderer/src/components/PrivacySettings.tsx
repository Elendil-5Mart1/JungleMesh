//* "Privacy" tab: stealth mode and IP protection in voice
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '../../../shared/types'
import { BackupPanel } from './BackupPanel'
import { Toggle } from '@/components/Toggle'

// Choices offered for the lifetime of shared images (hours; 0 = never)
export const TTL_CHOICES = [1, 24, 72, 168, 720, 0]

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

export const PrivacySettings = ({ settings, onChange }: Props) => {
  const { t } = useTranslation()
  // The relay fields are validated on the main side: we type locally, we save when leaving the field
  const [turn, setTurn] = useState({ url: settings.turnUrl, user: settings.turnUser, pass: settings.turnPass })
  useEffect(() => setTurn({ url: settings.turnUrl, user: settings.turnUser, pass: settings.turnPass }), [settings.turnUrl, settings.turnUser, settings.turnPass])
  const invalid = turn.url !== '' && turn.url !== settings.turnUrl // rejected by validation = read back empty or the old value

  const commit = (): void => onChange({ turnUrl: turn.url.trim(), turnUser: turn.user, turnPass: turn.pass })

  return (
    <section>
      <h2>{t('settings.tabs.privacy')}</h2>
      <p className="settings__hint">{t('privacy.intro')}</p>

      <h3>{t('privacy.network')}</h3>
      <Toggle
        checked={settings.stealth}
        onChange={(stealth) => onChange({ stealth })}
        label={t('privacy.stealth')}
        hint={t('privacy.stealthHint')}
      />

      <h3>{t('privacy.images')}</h3>
      <label className="settings__field">
        {t('privacy.imageTtl')}
        <select
          value={settings.imageTtlHours}
          onChange={(e) => onChange({ imageTtlHours: Number(e.target.value) })}
        >
          {TTL_CHOICES.map((hours) => (
            <option key={hours} value={hours}>
              {t(`ttl.${hours}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="settings__hint">{t('privacy.imageTtlHint')}</p>

      <h3>{t('privacy.appearance')}</h3>
      <Toggle
        checked={settings.hideNotificationContent}
        onChange={(hideNotificationContent) => onChange({ hideNotificationContent })}
        label={t('privacy.hideContent')}
        hint={t('privacy.hideContentHint')}
      />
      <Toggle
        checked={settings.contentProtection}
        onChange={(contentProtection) => onChange({ contentProtection })}
        label={t('privacy.contentProtection')}
        hint={t('privacy.contentProtectionHint')}
      />

      <h3>{t('privacy.voice')}</h3>
      <Toggle
        checked={settings.voiceRelayOnly}
        onChange={(voiceRelayOnly) => onChange({ voiceRelayOnly })}
        label={t('privacy.relayOnly')}
        hint={t('privacy.relayOnlyHint')}
      />
      {settings.voiceRelayOnly && !settings.turnUrl && <p className="home__error">{t('voice.relayMissing')}</p>}

      <div className="settings__field">
        <span>{t('privacy.turnUrl')}</span>
        <input
          value={turn.url}
          placeholder="turns:turn.example.org:443"
          spellCheck={false}
          onChange={(e) => setTurn({ ...turn, url: e.target.value })}
          onBlur={commit}
        />
        {invalid && <span className="settings__hint">{t('privacy.turnInvalid')}</span>}
      </div>
      <div className="settings__field">
        <span>{t('privacy.turnUser')}</span>
        <input value={turn.user} spellCheck={false} autoComplete="off" onChange={(e) => setTurn({ ...turn, user: e.target.value })} onBlur={commit} />
      </div>
      <div className="settings__field">
        <span>{t('privacy.turnPass')}</span>
        <input type="password" value={turn.pass} autoComplete="off" onChange={(e) => setTurn({ ...turn, pass: e.target.value })} onBlur={commit} />
      </div>
      <p className="settings__hint">{t('privacy.turnHint')}</p>

      <h3>{t('privacy.updates')}</h3>
      <Toggle
        checked={settings.autoUpdate}
        onChange={(autoUpdate) => onChange({ autoUpdate })}
        label={t('privacy.autoUpdate')}
        hint={t('privacy.autoUpdateHint')}
      />

      <h3>{t('privacy.backup')}</h3>
      <p className="settings__hint">{t('privacy.backupIntro')}</p>
      <BackupPanel />

      <h3>{t('privacy.danger')}</h3>
      <div className="settings__field">
        <div className="settings__row">
          <button type="button" className="settings__button" onClick={() => void window.api.resetData('identity')}>
            {t('privacy.newIdentity')}
          </button>
        </div>
        <span className="settings__hint">{t('privacy.newIdentityHint')}</span>
      </div>
      <div className="settings__field">
        <div className="settings__row">
          <button type="button" className="settings__button settings__button--danger" onClick={() => void window.api.resetData('all')}>
            {t('privacy.eraseAll')}
          </button>
        </div>
        <span className="settings__hint">{t('privacy.eraseAllHint')}</span>
      </div>
    </section>
  )
}
