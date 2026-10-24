//* Scrolling message list, shared by DMs and rooms
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { Avatar } from '@/components/Avatar'
import { Markdown } from '@/components/Markdown'
import { FileCard } from '@/components/FileCard'
import { Embeds } from '@/components/Embeds'
import { Icon } from '@/components/Icon'
import { ContextMenu, MenuItem, type MenuSpot } from '@/components/ContextMenu'
import { useTranslation } from 'react-i18next'

// Same lazy loading as in the composer: the emoji data only loads on first use
const EmojiPicker = lazy(() => import('./EmojiPicker'))

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
  onEdit?: (id: string, text: string) => void // edit one of MY messages
  onReact?: (id: string, to: string, emoji: string, on: boolean) => void // add / remove my reaction (to = author)
}

//& Actions of a row, grouped in one stable object (the rows are memoized: a new function on every
// render of the list would re-render all of them)
interface RowActions {
  menu: (m: ChatMessage, spot: MenuSpot) => void // right click
  pick: (m: ChatMessage, spot: MenuSpot) => void // emoji picker for a reaction
  edit: (id: string | null) => void // start (id) / stop (null) editing
  save: (id: string, text: string) => void
  toggle: (m: ChatMessage, emoji: string) => void // click on a reaction pill
  nameOf: (key: string) => string
}

//& Text being edited, in place: Enter saves, Shift+Enter = line break, Escape cancels (like Discord)
const EditBox = ({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) => {
  const { t } = useTranslation()
  const [text, setText] = useState(initial)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSave(text)
    }
  }
  return (
    <div className="message__edit">
      <textarea
        autoFocus
        value={text}
        rows={Math.min(8, text.split('\n').length)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        // cursor at the end of the text, not at the start
        onFocus={(e) => e.currentTarget.setSelectionRange(text.length, text.length)}
      />
      <p className="message__edit-hint">{t('message.editHint')}</p>
    </div>
  )
}

//& One message. memo: only re-rendered when ITS props change, not for every new message, call update
// or splitter drag of the window (plain values only, so the comparison is cheap and reliable)
interface RowProps {
  m: ChatMessage
  grouped: boolean
  name: string
  avatar: string | null
  mine: boolean
  myKey?: string
  deletable: boolean // mine AND the conversation allows deleting
  editable: boolean // mine AND the conversation allows editing
  reactable: boolean
  editing: boolean
  ttlHours: number
  actions: RowActions
}

const MessageRow = memo(({ m, grouped, name, avatar, mine, myKey, deletable, editable, reactable, editing, ttlHours, actions }: RowProps) => {
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
  const spotOf = (el: HTMLElement): MenuSpot => {
    const box = el.getBoundingClientRect()
    return { x: box.left, y: box.bottom }
  }
  const reactions = Object.entries(m.reactions ?? {})
  return (
    <article
      className={`message ${grouped ? 'message--grouped' : ''} ${editing ? 'message--editing' : ''}`}
      onContextMenu={(e) => {
        // Selected text: the native Copy menu wins over ours (see main/textMenu.ts)
        if (!(deletable || editable || reactable) || editing || window.getSelection()?.isCollapsed === false) return
        e.preventDefault()
        actions.menu(m, { x: e.clientX, y: e.clientY })
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
        {editing ? (
          <EditBox initial={m.text} onSave={(text) => actions.save(m.id, text)} onCancel={() => actions.edit(null)} />
        ) : (
          m.text && <Markdown text={m.text} />
        )}
        {m.edited && !editing && (
          <span className="message__edited" title={new Date(m.edited).toLocaleString()}>
            {t('message.edited')}
          </span>
        )}
        {m.text && !editing && <Embeds text={m.text} />}
        {m.file && <FileCard file={m.file} ts={m.ts} ttlHours={ttlHours} />}
        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map(([emoji, who]) => (
              <button
                key={emoji}
                type="button"
                className={`reactions__pill ${myKey && who.includes(myKey) ? 'reactions__pill--mine' : ''}`}
                title={who.map(actions.nameOf).join(', ')}
                disabled={!reactable}
                onClick={() => actions.toggle(m, emoji)}
              >
                <span className="reactions__emoji">{emoji}</span>
                {who.length}
              </button>
            ))}
            {reactable && (
              <button
                type="button"
                className="reactions__pill reactions__pill--add"
                title={t('message.react')}
                aria-label={t('message.react')}
                onClick={(e) => actions.pick(m, spotOf(e.currentTarget))}
              >
                <Icon name="smile" size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      {/* Actions bar, only visible while hovering the message (like Discord) */}
      {!editing && (reactable || editable || deletable) && (
        <div className="message__actions">
          {reactable && (
            <button type="button" title={t('message.react')} aria-label={t('message.react')} onClick={(e) => actions.pick(m, spotOf(e.currentTarget))}>
              <Icon name="smile" size={18} />
            </button>
          )}
          {editable && (
            <button type="button" title={t('message.edit')} aria-label={t('message.edit')} onClick={() => actions.edit(m.id)}>
              <Icon name="pencil" size={18} />
            </button>
          )}
          {deletable && (
            <button
              type="button"
              className="message__action--danger"
              title={t('message.delete')}
              aria-label={t('message.delete')}
              onClick={(e) => actions.menu(m, spotOf(e.currentTarget))}
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      )}
    </article>
  )
})

export const MessageList = ({ messages, myKey, author, empty, imageTtlHours = 0, onDelete, onEdit, onReact }: MessageListProps) => {
  const { t } = useTranslation()
  const listRef = useRef<HTMLElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ m: ChatMessage; spot: MenuSpot } | null>(null)
  const [picker, setPicker] = useState<{ m: ChatMessage; spot: MenuSpot } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // The latest props, read by the stable actions below (they never change identity)
  const latest = useRef({ author, myKey, onEdit, onReact, messages })
  latest.current = { author, myKey, onEdit, onReact, messages }
  const actions = useRef<RowActions>({
    menu: (m, spot) => setMenu({ m, spot }),
    pick: (m, spot) => setPicker({ m, spot }),
    edit: setEditingId,
    save: (id, text) => {
      const { messages: list, onEdit: edit } = latest.current
      const before = list.find((x) => x.id === id)
      // Unchanged, or emptied without an attachment: nothing to write (deleting is the trash button's job)
      if (before && text !== before.text && (text.trim() || before.file)) edit?.(id, text)
      setEditingId(null)
    },
    toggle: (m, emoji) => {
      const { myKey: me, onReact: react } = latest.current
      if (me) react?.(m.id, m.from, emoji, !m.reactions?.[emoji]?.includes(me))
    },
    nameOf: (key) => latest.current.author(key).name
  }).current

  // Automatic scroll to the latest message, but only if the user is following the conversation
  // (reading older messages higher up must not be interrupted), or if the new message is mine.
  // First display of the history: straight to the bottom, without the smooth animation.
  const following = useRef(true)
  const firstScroll = useRef(true)
  const lastTop = useRef(0)
  const lastCount = useRef(0)
  // Only the user scrolling UP stops the following: the steps of our own smooth scroll (which goes down)
  // are far from the bottom too, and used to switch it off halfway
  const onScroll = (): void => {
    const el = listRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) following.current = true
    else if (el.scrollTop < lastTop.current) following.current = false
    lastTop.current = el.scrollTop
  }
  useEffect(() => {
    // An edit or a reaction changes the list without adding a message: no scrolling for that
    const added = messages.length > lastCount.current
    lastCount.current = messages.length
    if (!added && !firstScroll.current) return
    const last = messages[messages.length - 1]
    if (firstScroll.current || following.current || (last && last.from === myKey)) {
      following.current = true
      bottomRef.current?.scrollIntoView({ behavior: firstScroll.current ? 'auto' : 'smooth' })
    }
    if (messages.length > 0) firstScroll.current = false
  }, [messages])

  // Images arrive AFTER their message (fetched from the core) and push the bottom further down:
  // each loaded image puts the view back at the bottom if we were following.
  // `load` does not bubble, but a listener in the capture phase on the list still sees it.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onLoad = (): void => {
      if (following.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener('load', onLoad, true)
    return () => el.removeEventListener('load', onLoad, true)
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])
  const closePicker = useCallback(() => setPicker(null), [])

  return (
    <main className="chat__messages" ref={listRef} onScroll={onScroll}>
      {messages.length === 0 && empty && <p className="chat__empty">{empty}</p>}
      {messages.map((m, i) => {
        // Like Discord: consecutive messages from the same author are grouped (< 5 min)
        const prev = messages[i - 1]
        const grouped = !!prev && !prev.system && prev.from === m.from && m.ts - prev.ts < 5 * 60_000
        const who = author(m.from)
        const mine = m.from === myKey
        return (
          <MessageRow
            key={m.id}
            m={m}
            grouped={grouped}
            name={who.name}
            avatar={who.avatar}
            mine={mine}
            myKey={myKey}
            deletable={!!onDelete && mine}
            editable={!!onEdit && mine && !m.call}
            reactable={!!onReact && !!myKey}
            editing={editingId === m.id}
            ttlHours={imageTtlHours}
            actions={actions}
          />
        )
      })}
      <div ref={bottomRef} />

      {/* Right click on a message: react, and for MY messages edit / delete */}
      {menu && (
        <ContextMenu spot={menu.spot} onClose={closeMenu}>
          {onReact && myKey && (
            <MenuItem
              label={t('message.react')}
              onSelect={() => {
                setPicker(menu)
                setMenu(null)
              }}
            />
          )}
          {onEdit && menu.m.from === myKey && (
            <MenuItem
              label={t('message.edit')}
              onSelect={() => {
                setEditingId(menu.m.id)
                setMenu(null)
              }}
            />
          )}
          {onDelete && menu.m.from === myKey && (
            <MenuItem
              danger
              label={t('message.delete')}
              confirmLabel={t('message.deleteConfirm')}
              onSelect={() => {
                onDelete(menu.m.id)
                setMenu(null)
              }}
            />
          )}
        </ContextMenu>
      )}

      {/* Emoji picker for a reaction: picking an emoji I already put does nothing (the pill removes it) */}
      {picker && onReact && myKey && (
        <ContextMenu spot={picker.spot} onClose={closePicker} className="ctx--bare">
          <Suspense fallback={null}>
            <EmojiPicker
              onPick={(emoji) => {
                if (!picker.m.reactions?.[emoji]?.includes(myKey)) onReact(picker.m.id, picker.m.from, emoji, true)
                setPicker(null)
              }}
            />
          </Suspense>
        </ContextMenu>
      )}
    </main>
  )
}
