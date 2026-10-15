//* Scrolling message list, shared by DMs and rooms
import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { Avatar } from '@/components/Avatar'
import { Markdown } from '@/components/Markdown'

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
}

export const MessageList = ({ messages, myKey, author, empty }: MessageListProps) => {
  const bottomRef = useRef<HTMLDivElement>(null)

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
          <article key={m.id} className={`message ${grouped ? 'message--grouped' : ''}`}>
            {!grouped && <Avatar src={who.avatar} name={who.name} seed={m.from} size={40} />}
            <div className="message__body">
              {!grouped && (
                <header className="message__meta">
                  <strong className={m.from === myKey ? 'message__author--me' : ''}>{who.name}</strong>
                  <time>{formatTime(m.ts)}</time>
                </header>
              )}
              <Markdown text={m.text} />
            </div>
          </article>
        )
      })}
      <div ref={bottomRef} />
    </main>
  )
}
