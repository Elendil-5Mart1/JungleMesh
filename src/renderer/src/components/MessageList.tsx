//* Scrolling message list, shared by DMs and rooms
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { Avatar } from '@/components/Avatar'
import { Markdown } from '@/components/Markdown'
import { FileCard } from '@/components/FileCard'
import { ContextMenu, MenuItem, type MenuSpot } from '@/components/ContextMenu'
import { useTranslation } from 'react-i18next'

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

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

export const MessageList = ({ messages, myKey, author, empty, imageTtlHours = 0, onDelete }: MessageListProps) => {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ id: string; spot: MenuSpot } | null>(null)

  // Automatic scroll to the latest message (and when the channel changes)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <main className="chat__messages">
      {messages.length === 0 && empty && <p className="chat__empty">{empty}</p>}
      {messages.map((m, i) => {
        // System message ("X joined the room"): a discreet, centered line
        if (m.system) {
          return (
            <div key={m.id} className="message message--system">
              <Markdown text={m.text} />
            </div>
          )
        }
        // Like Discord: consecutive messages from the same author are grouped (< 5 min)
        const prev = messages[i - 1]
        const grouped = prev && !prev.system && prev.from === m.from && m.ts - prev.ts < 5 * 60_000
        const who = author(m.from)
        return (
          <article
            key={m.id}
            className={`message ${grouped ? 'message--grouped' : ''}`}
            onContextMenu={(e) => {
              if (!onDelete || m.from !== myKey) return
              e.preventDefault()
              setMenu({ id: m.id, spot: { x: e.clientX, y: e.clientY } })
            }}
          >
            {!grouped && <Avatar src={who.avatar} name={who.name} seed={m.from} size={40} />}
            <div className="message__body">
              {!grouped && (
                <header className="message__meta">
                  <strong className={m.from === myKey ? 'message__author--me' : ''}>{who.name}</strong>
                  <time>{formatTime(m.ts)}</time>
                </header>
              )}
              {m.text && <Markdown text={m.text} />}
              {m.file && <FileCard file={m.file} ts={m.ts} ttlHours={imageTtlHours} />}
            </div>
            {onDelete && m.from === myKey && (
              <button
                type="button"
                className="message__delete"
                title={t('message.delete')}
                aria-label={t('message.delete')}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect()
                  setMenu({ id: m.id, spot: { x: box.left, y: box.bottom } })
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                </svg>
              </button>
            )}
          </article>
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
