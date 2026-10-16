//* Room window, Discord layout:
// [ navigation: room + channels ] [ chat of the selected channel ] [ members ]
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ChannelKind, ChatMessage } from '../../../shared/types'
import { useCoreStore } from '@/stores/useCoreStore'
import { Avatar } from '@/components/Avatar'
import { MessageList, type Author } from '@/components/MessageList'
import { Composer } from '@/components/Composer'
import { RoomSettings } from '@/components/RoomSettings'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'
import { useVoice } from '@/voice/useVoice'
import { Splitter, useColumnWidth } from '@/components/Splitter'
import { ContextMenu, MenuItem, type MenuSpot } from '@/components/ContextMenu'
import { getVoiceVolume, saveVoiceVolume } from '@/utils/voiceVolume'
import { sendMessage } from '@/utils/sendMessage'

const EMPTY: never[] = [] // stable reference: avoids an infinite re-render with Zustand

// Channel of a message ('general' if missing: old messages, system messages)
const channelOf = (m: ChatMessage): string => m.channel ?? 'general'

// Last channel opened in this room, remembered in THIS window (simple convenience)
const lastChannelKey = (roomKey: string): string => `channel:${roomKey}`
const loadLastChannel = (roomKey: string): string => {
  try {
    return localStorage.getItem(lastChannelKey(roomKey)) ?? 'general'
  } catch {
    return 'general'
  }
}

export const RoomView = ({ roomKey }: { roomKey: string }) => {
  const { t } = useTranslation()
  const me = useCoreStore((s) => s.me)
  const room = useCoreStore((s) => s.rooms?.find((r) => r.key === roomKey))
  const friends = useCoreStore((s) => s.friends) ?? EMPTY
  const messages = useCoreStore((s) => s.messages[roomKey] ?? EMPTY)
  const settings = useCoreStore((s) => s.settings)
  const setHistory = useCoreStore((s) => s.setHistory)

  const [channelId, setChannelId] = useState(() => loadLastChannel(roomKey))
  const [creating, setCreating] = useState<ChannelKind | null>(null) // "new channel" form
  const [newChannel, setNewChannel] = useState('')
  const [inviting, setInviting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menu, setMenu] = useState<{ key: string; spot: MenuSpot } | null>(null) // right click on a person
  const [volume, setVolume] = useState(1) // volume of the person in the open menu
  const [error, setError] = useState('')
  // Resizable side columns (width remembered)
  const [navWidth, setNavWidth] = useColumnWidth('room:navWidth', 220, 140, 400)
  const [membersWidth, setMembersWidth] = useColumnWidth('room:membersWidth', 220, 120, 360)
  // Number of messages already seen per channel → the other channels show "unread" in bold
  const [seen, setSeen] = useState<Record<string, number>>({})

  // Voice call (only one channel at a time): microphone + WebRTC connections with the other participants
  const voice = useVoice(roomKey, me?.publicKey, room?.voice)

  // History reloads when the status changes (e.g. "joining" → "joined")
  useEffect(() => {
    void window.api.getHistory(roomKey).then((list) => setHistory(roomKey, list))
  }, [roomKey, room?.status, setHistory])

  useEffect(() => {
    if (room) document.title = room.name
  }, [room?.name])

  // Voice channel deleted (or room without this channel) during the call: we hang up
  useEffect(() => {
    if (voice.activeChan && room && !room.channels.some((c) => c.id === voice.activeChan)) voice.leave()
  }, [room?.channels, voice.activeChan])

  // Messages grouped by channel (recomputed only when the list changes)
  const byChannel = useMemo(() => {
    const map: Record<string, ChatMessage[]> = {}
    for (const m of messages) (map[channelOf(m)] ??= []).push(m)
    return map
  }, [messages])

  // The displayed channel is always "seen"; on first load, everything is considered seen
  useEffect(() => {
    setSeen((prev) => {
      const next = { ...prev, [channelId]: byChannel[channelId]?.length ?? 0 }
      for (const id of Object.keys(byChannel)) next[id] ??= byChannel[id].length
      return next
    })
  }, [byChannel, channelId])

  if (!room) return <div className="home home--loading">{t('room.notFound')}</div>

  // Selected channel gone (or unknown id) → back to the general channel
  const channel = room.channels.find((c) => c.id === channelId) ?? room.channels[0]
  const textChannels = room.channels.filter((c) => c.kind === 'text')
  const voiceChannels = room.channels.filter((c) => c.kind === 'voice')

  // A click on a voice channel selects it AND joins the call (like Discord)
  const openChannel = (c: (typeof room.channels)[number]): void => {
    selectChannel(c.id)
    if (c.kind === 'voice' && room.status === 'joined') void voice.join(c.id)
  }

  const selectChannel = (id: string): void => {
    setChannelId(id)
    try {
      localStorage.setItem(lastChannelKey(roomKey), id)
    } catch {
      // storage unavailable: we do not need it to work
    }
  }

  // Runs an action and displays the error, if any
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    try {
      await action()
      setError('')
      return true
    } catch (err) {
      setError(cleanError(err))
      return false
    }
  }

  const send = async (text: string, files: File[]): Promise<void> => {
    if (!(await run(() => sendMessage(roomKey, text, files, channel.id)))) throw new Error('send failed') // keeps the text
  }

  const createChannel = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!creating) return
    if (await run(() => window.api.createChannel(roomKey, newChannel, creating))) {
      setNewChannel('')
      setCreating(null)
    }
  }

  const author = (key: string): Author => {
    const m = room.members.find((x) => x.key === key)
    return { name: m?.name ?? key.slice(0, 8), avatar: m?.avatar ?? null }
  }

  // Invitable friends: accepted, neither members nor already invited
  const invitable = friends.filter(
    (f) => f.status === 'accepted' && !room.members.some((m) => m.key === f.key) && !room.pendingInvites.includes(f.key)
  )
  const pending = friends.filter((f) => room.pendingInvites.includes(f.key))
  const online = room.members.filter((m) => m.online)
  const offline = room.members.filter((m) => !m.online)

  // Right click on a person (member list, voice channel list or voice view)
  const openMenu = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (key !== me?.publicKey) setVolume(getVoiceVolume(key))
    setMenu({ key, spot: { x: e.clientX, y: e.clientY } })
  }

  const changeVolume = (key: string, value: number): void => {
    setVolume(value)
    saveVoiceVolume(key, value)
    voice.session.current?.setVolume(key, value)
  }

  // Green ring around the avatar of someone who is speaking (only visible if we are in this channel)
  const renderRing = (key: string, avatar: React.ReactNode) => (
    <span className={`voice-ring ${voice.status?.speaking.includes(key) ? 'voice-ring--speaking' : ''}`}>
      {avatar}
      {/* When the person speaks: the inside of the bubble becomes an animated wave on a black background */}
      {voice.status?.speaking.includes(key) && (
        <span className="voice-wave" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="voice-wave__bar" style={{ animationDelay: `${i * 0.11}s` }} />
          ))}
        </span>
      )}
    </span>
  )

  // A group of channels in the navigation (text or voice).
  // Render function and NOT a component: a component declared here would be recreated on every
  // render, and the "new channel" field would lose focus on every typed letter.
  const renderGroup = (kind: ChannelKind, title: string, list: typeof room.channels) => (
    <section className="room-nav__group">
      <h2 className="room-nav__title">
        {title}
        {room.isOwner && (
          <button
            type="button"
            className="room-nav__add"
            title={t(kind === 'text' ? 'room.createText' : 'room.createVoice')}
            onClick={() => setCreating(creating === kind ? null : kind)}
          >
            {creating === kind ? '×' : '+'}
          </button>
        )}
      </h2>
      {creating === kind && (
        <form className="room-nav__form" onSubmit={createChannel}>
          <input
            autoFocus
            placeholder={t(kind === 'text' ? 'room.newTextName' : 'room.newVoiceName')}
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
          />
        </form>
      )}
      {list.map((c) => {
        const unseen = c.kind === 'text' && c.id !== channel.id && (byChannel[c.id]?.length ?? 0) > (seen[c.id] ?? 0)
        return (
          <div key={c.id}>
            <button
              type="button"
              className={`room-nav__channel ${c.id === channel.id ? 'room-nav__channel--active' : ''} ${unseen ? 'room-nav__channel--unread' : ''}`}
              onClick={() => openChannel(c)}
            >
              <span className="room-nav__icon">{c.kind === 'text' ? '#' : '🔊'}</span>
              <span className="room-nav__name">{c.name}</span>
            </button>
            {/* Who is in this voice channel */}
            {c.kind === 'voice' && (room.voice[c.id]?.length ?? 0) > 0 && (
              <div className="voicers">
                {room.voice[c.id].map((key) => {
                  const a = author(key)
                  return (
                    <div key={key} className="voicers__user" onContextMenu={openMenu(key)}>
                      {renderRing(key, <Avatar src={a.avatar} name={a.name} seed={key} size={22} />)}
                      <span className="room-nav__name">{a.name}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )

  return (
    <div
      className="room"
      style={{ '--nav-w': `${navWidth}px`, '--members-w': `${membersWidth}px` } as React.CSSProperties}
    >
      {/*& Left column: the room and its channels */}
      <nav className="room-nav">
        <header className="room-nav__header">
          <Avatar
            src={room.avatar}
            name={room.name}
            seed={room.key}
            size={36}
            onChange={room.isOwner ? (avatar) => window.api.setRoomAvatar(roomKey, avatar) : undefined}
          />
          <h1 className="room-nav__room">{room.name}</h1>
          {/* Buttons on their own line under the name, aligned right */}
          <div className="room-nav__actions">
            {/* Any signed-up member can invite their own friends */}
            {room.status === 'joined' && (
              <button
                type="button"
                className={`room-nav__invite ${inviting ? 'room-nav__invite--on' : ''}`}
                title={t('room.inviteFriends')}
                onClick={() => setInviting(!inviting)}
              >
                👤+
              </button>
            )}
            <button
              type="button"
              className="room-nav__invite"
              title={t('roomSettings.title')}
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
          </div>
        </header>

        {/* Invitation panel */}
        {inviting && (
          <section className="room-nav__invites">
            {invitable.length === 0 && <p className="room-nav__hint">{t('room.allInvited')}</p>}
            {invitable.map((f) => (
              <button
                key={f.key}
                type="button"
                className="room-nav__friend"
                onClick={() => void run(() => window.api.inviteToRoom(roomKey, f.key))}
              >
                <Avatar src={f.avatar} name={f.name} seed={f.key} size={24} status={f.online ? 'online' : 'offline'} />
                {f.name}
              </button>
            ))}
            {pending.length > 0 && (
              <p className="room-nav__hint">
                {t('room.pendingInvites', { names: pending.map((f) => f.name).join(', ') })}
                {pending.some((f) => !f.online) && ` ${t('room.pendingOffline')}`}
              </p>
            )}
          </section>
        )}

        <div className="room-nav__channels">
          {renderGroup('text', t('room.textChannels'), textChannels)}
          {renderGroup('voice', t('room.voiceChannels'), voiceChannels)}
        </div>

        {/* Call in progress: reminder + hang up, even when reading a text channel */}
        {voice.activeChan && (
          <div className="voice-bar">
            <span className="voice-bar__where">
              🔊 {room.channels.find((c) => c.id === voice.activeChan)?.name ?? t('room.voice')}
            </span>
            <button type="button" className="voice__btn voice__btn--leave" title={t('room.hangUp')} onClick={voice.leave}>
              ✕
            </button>
          </div>
        )}

        {/* Me, at the bottom of the column (like Discord) */}
        {me && (
          <footer className="room-nav__me">
            {renderRing(me.publicKey, <Avatar src={me.avatar} name={me.name} seed={me.publicKey} size={32} status="online" />)}
            <span className="room-nav__name">{me.name}</span>
          </footer>
        )}
      </nav>
      <Splitter side="left" width={navWidth} onChange={setNavWidth} />

      {/*& Center: the selected channel */}
      <div className="chat room__chat">
        <header className="chat__header">
          <span className="room__hash">{channel.kind === 'text' ? '#' : '🔊'}</span>
          <h1>{channel.name}</h1>
          <span className="room__count">
            {online.length}/{room.members.length} en ligne
          </span>
        </header>

        {error && <p className="chat__error">{error}</p>}
        {room.status === 'joining' && (
          <p className="room__banner">{t('room.waitingEnroll')}</p>
        )}

        {channel.kind === 'voice' ? (
          <div className="voice">
            <div className="voice__users">
              {(room.voice[channel.id] ?? []).map((key) => {
                const a = author(key)
                const inCall = voice.activeChan === channel.id
                const link = voice.status?.links[key]
                return (
                  <div key={key} className="voice__user" onContextMenu={openMenu(key)}>
                    {renderRing(key, <Avatar src={a.avatar} name={a.name} seed={key} size={72} />)}
                    <span>{a.name}</span>
                    {inCall && key !== me?.publicKey && (
                      <span className={`voice__link voice__link--${link ?? 'connecting'}`}>
                        {t(`room.link.${link ?? 'connecting'}`)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {(room.voice[channel.id]?.length ?? 0) === 0 && (
              <p className="voice__hint">{t('room.nobody', { name: channel.name })}</p>
            )}
            {voice.error && <p className="chat__error">{voice.error}</p>}
            {voice.status?.phase === 'live' && voice.activeChan === channel.id ? (
              <div className="voice__controls">
                <button
                  type="button"
                  className={`voice__btn ${voice.status.muted ? 'voice__btn--off' : ''}`}
                  title={voice.status.muted ? t('room.unmute') : t('room.mute')}
                  onClick={() => voice.session.current?.setMuted(!voice.status?.muted)}
                >
                  {voice.status.muted ? '🔇' : '🎤'}
                </button>
                <button
                  type="button"
                  className={`voice__btn ${voice.status.deafened ? 'voice__btn--off' : ''}`}
                  title={voice.status.deafened ? t('room.undeafen') : t('room.deafen')}
                  onClick={() => voice.session.current?.setDeafened(!voice.status?.deafened)}
                >
                  {voice.status.deafened ? '🙉' : '🎧'}
                </button>
                <button type="button" className="voice__btn voice__btn--leave" title={t('room.hangUp')} onClick={voice.leave}>
                  {t('room.leaveCall')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="voice__btn voice__btn--join"
                disabled={room.status !== 'joined' || voice.activeChan === channel.id}
                onClick={() => void voice.join(channel.id)}
              >
                {voice.activeChan === channel.id ? t('room.connecting') : t('room.joinVoice')}
              </button>
            )}
          </div>
        ) : (
          <>
            <MessageList
              messages={byChannel[channel.id] ?? EMPTY}
              myKey={me?.publicKey}
              author={author}
              empty={t('room.channelStart', { name: channel.name })}
              imageTtlHours={room.imageTtl ?? settings?.imageTtlHours}
              onDelete={(id) => void run(() => window.api.deleteMessage(roomKey, id))}
            />
            <Composer
              disabled={room.status !== 'joined'}
              placeholder={
                room.status === 'joined' ? t('room.sendIn', { name: channel.name }) : t('room.enrolling')
              }
              onSend={send}
              attachable
            />
          </>
        )}
      </div>
      <Splitter side="right" width={membersWidth} onChange={setMembersWidth} />

      {/*& Right column: members, online first (like Discord) */}
      <aside className="members">
        {[
          { title: t('room.online'), list: online },
          { title: t('room.offline'), list: offline }
        ].map(
          ({ title, list }) =>
            list.length > 0 && (
              <section key={title}>
                <h2 className="members__title">
                  {title} — {list.length}
                </h2>
                {[...list]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((m) => (
                    <div
                      key={m.key}
                      className={`members__item ${m.online ? '' : 'members__item--offline'}`}
                      onContextMenu={openMenu(m.key)}
                    >
                      {renderRing(
                        m.key,
                        <Avatar
                          src={m.avatar}
                          name={m.name}
                          seed={m.key}
                          size={32}
                          status={m.online ? 'online' : 'offline'}
                        />
                      )}
                      <span className="members__name">{m.name}</span>
                      {m.isOwner && (
                        <span className="members__owner" title={t('room.owner')}>
                          👑
                        </span>
                      )}
                    </div>
                  ))}
              </section>
            )
        )}
      </aside>

      {menu && (() => {
        const person = room.members.find((m) => m.key === menu.key)
        const name = person?.name ?? menu.key.slice(0, 8)
        const isMe = menu.key === me?.publicKey
        const friend = friends.find((f) => f.key === menu.key)
        // Volume only makes sense for someone in the voice channel I am in
        const inMyCall = !isMe && !!voice.activeChan && (room.voice[voice.activeChan] ?? []).includes(menu.key)
        const close = (): void => setMenu(null)
        return (
          <ContextMenu spot={menu.spot} onClose={close}>
            <div className="ctx__title">{name}</div>
            {inMyCall && (
              <label className="ctx__volume">
                {t('menu.volume', { percent: Math.round(volume * 100) })}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => changeVolume(menu.key, Number(e.target.value))}
                />
              </label>
            )}
            {!isMe && friend?.status === 'accepted' && (
              <MenuItem
                label={t('menu.openChat')}
                onSelect={() => {
                  void window.api.openChat(menu.key)
                  close()
                }}
              />
            )}
            {!isMe && !friend && (
              <MenuItem
                label={t('menu.addFriend')}
                onSelect={() => {
                  void window.api.addFriend(menu.key, name).catch((err) => setError(cleanError(err)))
                  close()
                }}
              />
            )}
            {room.isOwner && !isMe && !person?.isOwner && (
              <>
                <div className="ctx__sep" />
                <MenuItem
                  danger
                  label={t('menu.kick')}
                  confirmLabel={t('menu.kickConfirm')}
                  onSelect={() => {
                    void window.api.kickFromRoom(room.key, menu.key).catch((err) => setError(cleanError(err)))
                    close()
                  }}
                />
              </>
            )}
          </ContextMenu>
        )
      })()}

      {settingsOpen && <RoomSettings room={room} myKey={me?.publicKey} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
