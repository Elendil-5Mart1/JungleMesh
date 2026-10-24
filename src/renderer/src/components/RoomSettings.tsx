//* "Room settings" modal: the creator manages name, image lifetime and members; everyone can leave
// (channels are renamed / deleted by right click in the room's navigation)
import { useState } from 'react'
import type { Room } from '../../../shared/types'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'
import { cleanError } from '@/utils/errors'
import { TTL_CHOICES } from '@/components/PrivacySettings'

interface RoomSettingsProps {
  room: Room
  myKey?: string
  onClose: () => void
}

export const RoomSettings = ({ room, myKey, onClose }: RoomSettingsProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(room.name)
  const [error, setError] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Runs an action and displays the error, if any
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
      setError('')
    } catch (err) {
      setError(cleanError(err))
    }
  }

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box" role="dialog" aria-label={t('roomSettings.title')}>
        <header className="modal__header">
          <h2>{t('roomSettings.title')}</h2>
          <button type="button" className="modal__close" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={20} />
          </button>
        </header>

        {error && <p className="chat__error">{error}</p>}

        <div className="modal__body">
          {room.isOwner && (
            <>
              <section className="modal__section">
                <h3>{t('roomSettings.roomName')}</h3>
                <form
                  className="modal__inline"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run(() => window.api.renameRoom(room.key, name))
                  }}
                >
                  <input value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
                  <button type="submit" disabled={!name.trim() || name.trim() === room.name}>
                    {t('roomSettings.save')}
                  </button>
                </form>
              </section>

              <section className="modal__section">
                <h3>{t('roomSettings.imageTtl')}</h3>
                <select
                  value={room.imageTtl ?? 'default'}
                  onChange={(e) =>
                    void run(() => window.api.setRoomImageTtl(room.key, e.target.value === 'default' ? null : Number(e.target.value)))
                  }
                >
                  <option value="default">{t('roomSettings.imageTtlDefault')}</option>
                  {TTL_CHOICES.map((hours) => (
                    <option key={hours} value={hours}>
                      {t(`ttl.${hours}`)}
                    </option>
                  ))}
                </select>
                <p className="modal__hint">{t('roomSettings.imageTtlHint')}</p>
              </section>
            </>
          )}

          <section className="modal__section">
            <h3>{t('roomSettings.members', { count: room.members.length })}</h3>
            {room.members.map((m) => (
              <div key={m.key} className="modal__inline">
                <Avatar src={m.avatar} name={m.name} seed={m.key} size={28} status={m.online ? 'online' : 'offline'} />
                <span className="modal__grow">
                  {m.name} {m.isOwner && <Icon name="crown" size={14} className="modal__owner" />} {m.key === myKey && <em>{t('roomSettings.you')}</em>}
                </span>
                {room.isOwner && !m.isOwner && (
                  <button
                    type="button"
                    className="modal__danger"
                    onClick={() => void run(() => window.api.kickFromRoom(room.key, m.key))}
                  >
                    {t('roomSettings.kick')}
                  </button>
                )}
              </div>
            ))}
            {room.isOwner && (
              <p className="modal__hint">
                {t('roomSettings.kickHint')}
              </p>
            )}
          </section>

          {room.isOwner && (
            <section className="modal__section">
              <h3>{t('roomSettings.deleteRoomTitle')}</h3>
              {confirmDelete ? (
                <div className="modal__inline">
                  <span className="modal__grow">{t('roomSettings.deleteRoomAsk', { name: room.name })}</span>
                  <button
                    type="button"
                    className="modal__danger"
                    onClick={() => void run(() => window.api.deleteRoom(room.key))}
                  >
                    {t('roomSettings.deleteRoomYes')}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="modal__danger" onClick={() => setConfirmDelete(true)}>
                  {t('roomSettings.deleteRoom')}
                </button>
              )}
              <p className="modal__hint">{t('roomSettings.deleteRoomHint')}</p>
            </section>
          )}

          {!room.isOwner && (
            <section className="modal__section">
              <h3>{t('roomSettings.leave')}</h3>
              {confirmLeave ? (
                <div className="modal__inline">
                  <span className="modal__grow">{t('roomSettings.leaveAsk', { name: room.name })}</span>
                  <button
                    type="button"
                    className="modal__danger"
                    onClick={() => void run(() => window.api.leaveRoom(room.key))}
                  >
                    {t('roomSettings.leaveYes')}
                  </button>
                  <button type="button" onClick={() => setConfirmLeave(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="modal__danger" onClick={() => setConfirmLeave(true)}>
                  {t('roomSettings.leaveRoom')}
                </button>
              )}
              <p className="modal__hint">{t('roomSettings.leaveHint')}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
