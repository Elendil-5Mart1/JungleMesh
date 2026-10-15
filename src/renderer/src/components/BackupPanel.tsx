//* Identity backup: save an encrypted file / restore from one (the passphrase never leaves the app)
// `importOnly` = first-launch screen, where there is nothing to save yet.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'

export const BackupPanel = ({ importOnly = false }: { importOnly?: boolean }) => {
  const { t } = useTranslation()
  const [pass, setPass] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Runs an action and displays the error, if any
  const run = async (action: () => Promise<boolean>, done = ''): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (await action()) setMessage(done)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings__field">
      <input
        type="password"
        value={pass}
        autoComplete="off"
        placeholder={t('privacy.backupPass')}
        onChange={(e) => setPass(e.target.value)}
      />
      <div className="settings__row">
        {!importOnly && (
          <button
            type="button"
            className="settings__button"
            disabled={busy || pass.length < 8}
            onClick={() => void run(() => window.api.exportBackup(pass), t('privacy.backupDone'))}
          >
            {t('privacy.backupExport')}
          </button>
        )}
        <button
          type="button"
          className="settings__button"
          disabled={busy || pass.length < 8}
          onClick={() => void run(() => window.api.importBackup(pass))}
        >
          {t('privacy.backupImport')}
        </button>
      </div>
      {message && <span className="settings__hint">{message}</span>}
      {error && <span className="home__error">{error}</span>}
    </div>
  )
}
