//* Scrolling message list, shared by DMs and rooms
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { Avatar } from '@/components/Avatar'
import { Markdown } from '@/components/Markdown'
import { FileCard } from '@/components/FileCard'
import { Icon } from '@/components/Icon'
import { ContextMenu, MenuItem, type MenuSpot } from '@/components/ContextMenu'
import { useTranslation } from 'react-i18next'

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

// Below this distance from the bottom, the user is "following" the conversation: new messages scroll the view
const NEAR_BOTTOM_PX = 120

// Author of a message: what we need to display their name and avatar
export interface Author {
  name: string
  avatar: string | null
}

interface MessageListProps {
  messages: ChatMessage[]
  myKey?: string
  author: (key: string) => Author
  empty?: string // text when there are no messages yet
  imageTtlHours?: number // lifetime of the images in this conversation (0 / missing = never)
  onDelete?: (id: string) => void // delete one of MY messages (right click or the trash button)
}

//& One message. memo: only re-rendered when ITS props change, not for every new message, call update
// or splitter drag of the window (plain values only, so the comparison is cheap and reliable)
interface RowProps {
  m: ChatMessage
  grouped: boolean
  name: string
  avatar: string | null
  mine: boolean
  deletable: boolean // mine AND the conversation allows deleting
  ttlHours: number
  onMenu: (id: string, spot: MenuSpot) => void
}

const MessageRow = memo(({ m, grouped, name, avatar, mine, deletable, ttlHours, onMenu }: RowProps) => {
  const { t } = useTranslation()

  // Call event (DM): phone pictogram + "X declined the call", with the time
  if (m.call) {
    return (
      <div className="message message--system message--call">
        <Icon name="phone" size={14} />
        <span>{t(`call.${m.call}`, { name })}</span>
        <time>{formatTime(m.ts)}</time>
      </div>
    )
  }
  // System message ("X joined the room"): a discreet, centered line
  if (m.system) {
    return (
      <div className="message message--system">
        <Markdown text={m.text} />
      </div>
    )
  }
  return (
    <article
      className={`message ${grouped ? 'message--grouped' : ''}`}
      onContextMenu={(e) => {
        if (!deletable) return
        e.preventDefault()
        onMenu(m.id, { x: e.clientX, y: e.clientY })
      }}
    >
      {!grouped && <Avatar src={avatar} name={name} seed={m.from} size={40} />}
      <div className="message__body">
        {!grouped && (
          <header className="message__meta">
            <strong className={mine ? 'message__author--me' : ''}>{name}</strong>
            <time>{formatTime(m.ts)}</time>
          </header>
        )}
        {m.text && <Markdown text={m.text} />}
        {m.file && <FileCard file={m.file} ts={m.ts} ttlHours={ttlHours} />}
      </div>
      {deletable && (
        <button
          type="button"
          className="message__delete"
          title={t('message.delete')}
          aria-label={t('message.delete')}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            onMenu(m.id, { x: box.left, y: box.bottom })
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
          </svg>
        </button>
      )}
    </article>
  )
})

export const MessageList = ({ messages, myKey, author, empty, imageTtlHours = 0, onDelete }: MessageListProps) => {
  const { t } = useTranslation()
  const listRef = useRef<HTMLElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ id: string; spot: MenuSpot } | null>(null)
  const openMenu = useCallback((id: string, spot: MenuSpot) => setMenu({ id, spot }), [])

  // Automatic scroll to the latest message, but only if the user is following the conversation
  // (reading older messages higher up must not be interrupted), or if the new message is mine.
  // First display of the history: straight to the bottom, without the smooth animation.
  const following = useRef(true)
  const firstScroll = useRef(true)
  const onScroll = (): void => {
    const el = listRef.current
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (firstScroll.current || following.current || (last && last.from === myKey)) {
      bottomRef.current?.scrollIntoView({ behavior: firstScroll.current ? 'auto' : 'smooth' })
    }
    if (messages.length > 0) firstScroll.current = false
  }, [messages])

  return (
    <main className="chat__messages" ref={listRef} onScroll={onScroll}>
      {messages.length === 0 && empty && <p className="chat__empty">{empty}</p>}
      {messages.map((m, i) => {
        // Like Discord: consecutive messages from the same author are grouped (< 5 min)
        const prev = messages[i - 1]
        const grouped = !!prev && !prev.system && prev.from === m.from && m.ts - prev.ts < 5 * 60_000
        const who = author(m.from)
        return (
          <MessageRow
            key={m.id}
            m={m}
            grouped={grouped}
            name={who.name}
            avatar={who.avatar}
            mine={m.from === myKey}
            deletable={!!onDelete && m.from === myKey}
            ttlHours={imageTtlHours}
            onMenu={openMenu}
          />
        )
      })}
      <div ref={bottomRef} />
      {menu && onDelete && (
        <ContextMenu spot={menu.spot} onClose={() => setMenu(null)}>
          <MenuItem
            danger
            label={t('message.delete')}
            confirmLabel={t('message.deleteConfirm')}
            onSelect={() => {
              onDelete(menu.id)
              setMenu(null)
            }}
          />
        </ContextMenu>
      )}
    </main>
  )
}
