//* Home window: profile, requests/invitations, rooms and friends
// Each room and each friend opens in its own window.
import { useEffect, useState, type FormEvent } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { Avatar } from '@/components/Avatar'
import { Welcome } from '@/components/Welcome'
import { Trans, useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'

const EMPTY: never[] = []

// Red unread badge, Discord-style (capped at 99+)
const Badge = ({ count }: { count?: number }) =>
  count ? <span className="list__badge">{count > 99 ? '99+' : count}</span> : null

export const HomeView = () => {
  const { t } = useTranslation()
  const me = useCoreStore((s) => s.me)
  const friends = useCoreStore((s) => s.friends) ?? EMPTY
  const rooms = useCoreStore((s) => s.rooms) ?? EMPTY
  const unread = useCoreStore((s) => s.unread)
  const visible = useCoreStore((s) => s.visibleWindows)
  // "--open" class if this friend's/room's window is on screen
  const openClass = (id: string): string => (visible.includes(id) ? 'list__item--open' : '')

  // Collapsible forms: "+" next to the section title
  const [adding, setAdding] = useState<'friend' | 'room' | null>(null)
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [roomName, setRoomName] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  // Invite link clicked (junglemesh://add/<code>): we ask for confirmation before adding
  const [invite, setInvite] = useState<string | null>(null)
  const [inviteName, setInviteName] = useState('')

  useEffect(() => {
    void window.api.getPendingInvite().then(setInvite) // link received before the home window opened
    return window.api.onInviteLink(setInvite)
  }, [])

  if (!me) return <div className="home home--loading">{t('home.connecting')}</div>

  const requests = friends.filter((f) => f.status === 'incoming')
  const invites = rooms.filter((r) => r.status === 'invited')
  const contacts = friends.filter((f) => f.status !== 'incoming')
  const myRooms = rooms.filter((r) => r.status !== 'invited')

  const toggle = (form: 'friend' | 'room'): void => {
    setAdding(adding === form ? null : form)
    setError('')
  }

  // Small utility: runs an action and displays the error, if any
  const run = async (action: () => Promise<unknown>, onSuccess?: () => void): Promise<void> => {
    try {
      await action()
      setError('')
      onSuccess?.()
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const closeInvite = (): void => {
    setInvite(null)
    setInviteName('')
    void window.api.clearPendingInvite()
  }

  const confirmInvite = (): void => {
    if (invite) void run(() => window.api.addFriend(invite, inviteName), closeInvite)
  }

  // We copy the LINK (the code alone stays in Settings): one click and the app opens on the friend's side
  const copyCode = async (): Promise<void> => {
    await navigator.clipboard.writeText(`junglemesh://add/${me.inviteCode}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const addFriend = (e: FormEvent): void => {
    e.preventDefault()
    void run(
      () => window.api.addFriend(code, nickname),
      () => {
        setCode('')
        setNickname('')
        setAdding(null)
      }
    )
  }

  const createRoom = (e: FormEvent): void => {
    e.preventDefault()
    void run(
      async () => window.api.openRoom(await window.api.createRoom(roomName)), // created then opened
      () => {
        setRoomName('')
        setAdding(null)
      }
    )
  }

  return (
    <div className="home">
      {/* First launch: choose a display name and a picture */}
      {!me.named && <Welcome me={me} />}
      {/*& Profile */}
      <section className="home__profile">
        {/* My avatar: click to choose an image */}
        <Avatar
          src={me.avatar}
          name={me.name}
          seed={me.publicKey}
          size={56}
          onChange={(avatar) => window.api.setAvatar(avatar)}
        />
        <div className="home__identity">
          <input
            className="home__name"
            defaultValue={me.name}
            onBlur={(e) => void window.api.setName(e.target.value)}
            title={t('home.nameHint')}
          />
          <button type="button" className="home__key" onClick={copyCode} title={me.inviteCode}>
            {copied ? t('home.linkCopied') : t('home.copyLink')}
          </button>
        </div>
        {/* Isolated gear to the right of the profile */}
        <button
          type="button"
          className="home__gear"
          title={t('home.settings')}
          aria-label={t('home.settings')}
          onClick={() => void window.api.openSettings()}
        >
          {/* Solid, monochrome gear (Material "settings"): takes the text color */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.61.22L2.71 8.84a.49.49 0 0 0 .12.64l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z" />
          </svg>
        </button>
      </section>

      <div className="home__lists">
        {/*& Invite link received: never added without confirmation */}
        {invite && (
          <section className="requests">
            <h2 className="list__title">{t('home.inviteReceived')}</h2>
            <p className="requests__name">
              <Trans
                i18nKey="home.inviteAsk"
                values={{ code: `${invite.slice(0, 8)}…${invite.slice(-4)}` }}
                components={{ code: <code title={invite} /> }}
              />
            </p>
            <input
              className="requests__input"
              placeholder={t('home.nicknameOptional')}
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
            <div className="requests__item">
              <button type="button" className="requests__accept" onClick={confirmInvite}>
                {t('home.add')}
              </button>
              <button type="button" onClick={closeInvite}>
                {t('home.ignore')}
              </button>
            </div>
          </section>
        )}

        {/*& Friend requests and room invitations */}
        {(requests.length > 0 || invites.length > 0) && (
          <section className="requests">
            <h2 className="list__title">{t('home.waiting')}</h2>
            {requests.map((f) => (
              <div key={f.key} className="requests__item">
                <span className="requests__name">
                  <Trans i18nKey="home.wantsToAdd" values={{ name: f.name }} components={{ strong: <strong /> }} />
                </span>
                <button
                  type="button"
                  className="requests__accept"
                  onClick={() => void run(() => window.api.acceptRequest(f.key))}
                >
                  {t('home.accept')}
                </button>
                <button
                  type="button"
                  className="requests__decline"
                  onClick={() => void run(() => window.api.declineRequest(f.key))}
                >
                  {t('home.decline')}
                </button>
              </div>
            ))}
            {invites.map((r) => (
              <div key={r.key} className="requests__item">
                <span className="requests__name">
                  <Trans
                    i18nKey="home.invitesYou"
                    values={{ who: r.invitedBy, room: r.name }}
                    components={{ strong: <strong /> }}
                  />
                </span>
                <button
                  type="button"
                  className="requests__accept"
                  onClick={() =>
                    void run(
                      () => window.api.acceptRoomInvite(r.key),
                      () => void window.api.openRoom(r.key)
                    )
                  }
                >
                  {t('home.join')}
                </button>
                <button
                  type="button"
                  className="requests__decline"
                  onClick={() => void run(() => window.api.declineRoomInvite(r.key))}
                >
                  {t('home.decline')}
                </button>
              </div>
            ))}
          </section>
        )}

        {error && <p className="home__error">{error}</p>}

        {/*& Rooms */}
        <section className="list">
          <h2 className="list__title">
            {t('home.rooms')}
            <button type="button" className="list__add" onClick={() => toggle('room')} title={t('home.createRoom')}>
              {adding === 'room' ? '×' : '+'}
            </button>
          </h2>
          {adding === 'room' && (
            <form className="home__form" onSubmit={createRoom}>
              <input
                autoFocus
                placeholder={t('home.roomName')}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
              />
              <button type="submit">{t('home.create')}</button>
            </form>
          )}
          {myRooms.length === 0 && adding !== 'room' && (
            <p className="list__empty">{t('home.noRooms')}</p>
          )}
          {myRooms.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`list__item ${openClass(`room:${r.key}`)}`}
              onClick={() => void window.api.toggleRoom(r.key)}
            >
              <Avatar src={r.avatar} name={r.name} seed={r.key} size={32} />
              <span className="list__name">{r.name}</span>
              {r.status === 'joining' && <em className="list__pending">{t('home.joining')}</em>}
              <Badge count={unread[r.key]} />
            </button>
          ))}
        </section>

        {/*& Friends */}
        <section className="list">
          <h2 className="list__title">
            {t('home.friends')}
            <button type="button" className="list__add" onClick={() => toggle('friend')} title={t('home.addFriend')}>
              {adding === 'friend' ? '×' : '+'}
            </button>
          </h2>
          {/* Adding a friend: only one side pastes the code, the other just has to accept */}
          {adding === 'friend' && (
            <form className="home__form" onSubmit={addFriend}>
              <input
                autoFocus
                placeholder={t('home.friendCode')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input placeholder={t('home.nicknameOptional')} value={nickname} onChange={(e) => setNickname(e.target.value)} />
              <button type="submit">{t('home.sendRequest')}</button>
            </form>
          )}
          {contacts.length === 0 && adding !== 'friend' && (
            <p className="list__empty">{t('home.noFriends')}</p>
          )}
          {contacts.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`list__item ${openClass(`chat:${f.key}`)}`}
              disabled={f.status !== 'accepted'}
              onClick={() => void window.api.toggleChat(f.key)}
            >
              <Avatar src={f.avatar} name={f.name} seed={f.key} size={32} status={f.online ? 'online' : 'offline'} />
              <span className="list__name">{f.name}</span>
              {f.status === 'outgoing' && <em className="list__pending">{t('home.pending')}</em>}
              <Badge count={unread[f.key]} />
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}
