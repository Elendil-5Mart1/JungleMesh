//* Welcome screen (first launch): choose a display name and, optionally, a picture
// Shown as long as no name has been saved; the name can still be changed later from the home window.
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/Avatar'
import { BackupPanel } from '@/components/BackupPanel'
import type { Me } from '../../../shared/types'

export const Welcome = ({ me }: { me: Me }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [restoring, setRestoring] = useState(false)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (name.trim()) void window.api.setName(name)
  }

  return (
    <div className="modal">
      <form className="modal__box" role="dialog" aria-label={t('welcome.title')} onSubmit={submit}>
        <header className="modal__header">
          <h2>{t('welcome.title')}</h2>
        </header>
        <div className="modal__body welcome">
          <p className="welcome__intro">{t('welcome.intro')}</p>
          <Avatar
            src={me.avatar}
            name={name || me.name}
            seed={me.publicKey}
            size={96}
            onChange={(avatar) => window.api.setAvatar(avatar)}
          />
          <p className="modal__hint">{t('welcome.pickPicture')}</p>
          <input
            className="welcome__name"
            value={name}
            maxLength={32}
            autoFocus
            placeholder={t('welcome.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="welcome__start" disabled={!name.trim()}>
            {t('welcome.start')}
          </button>
          <button type="button" className="welcome__link" onClick={() => setRestoring(!restoring)}>
            {t('welcome.haveBackup')}
          </button>
          {restoring && <BackupPanel importOnly />}
        </div>
      </form>
    </div>
  )
}
