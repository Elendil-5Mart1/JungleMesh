//* Message list shared by the DM and room screens
// Mobile counterpart of src/renderer/src/components/MessageList.tsx. A long press on a message opens
// its menu (react, copy, edit and delete my own): the desktop's hover bar + right click.
// Attachments: components/FileCard (image in the chat, or a card to save the file).
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../src/shared/types'
import { call } from '../bridge'
import { DEFAULT_IMAGE_TTL_HOURS } from '../files'
import { FileCard } from './FileCard'
import { Markdown } from './Markdown'
import { ActionSheet, Prompt, type PromptSpec, type SheetSpec } from './Sheet'
import { colors, radius, space } from '../theme'

// Quick reactions of the long-press menu (the desktop has a full emoji picker)
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

const GROUP_MS = 5 * 60_000 // consecutive messages of the same author within 5 min share one header

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

//& One message
interface BubbleProps {
  msg: ChatMessage
  author: string
  mine: boolean
  myKey?: string
  header: boolean // first of a group: show the author and the time
  convKey: string
  imageTtlHours: number
  onLongPress: (msg: ChatMessage) => void
  onReact: (msg: ChatMessage, emoji: string) => void // tap on a reaction: add mine or take it back
}

const Bubble = ({ msg, author, mine, myKey, header, convKey, imageTtlHours, onLongPress, onReact }: BubbleProps) => {
  const { t } = useTranslation()

  // Call event written in the history (only "declined" for now): a system line
  if (msg.call) return <Text style={styles.system}>{t('call.declined', { name: author })}</Text>
  // System message of a room ("X joined the room"): a discreet, centered line
  // (written in Markdown: "**Alice** joined the room")
  if (msg.system) return <Markdown text={msg.text} style={styles.system} />

  const reactions = Object.entries(msg.reactions ?? {}).filter(([, keys]) => keys.length > 0)

  return (
    <Pressable
      style={({ pressed }) => [styles.message, header && styles.messageFirst, pressed && styles.messagePressed]}
      onLongPress={() => onLongPress(msg)}
      delayLongPress={350}
    >
      {header && (
        <Text style={styles.meta}>
          <Text style={[styles.author, mine && styles.authorMe]}>{author}</Text>
          {'  '}
          {time(msg.ts)}
        </Text>
      )}
      {!!msg.text && <Markdown text={msg.text} style={styles.text} />}
      {!!msg.file && (
        <FileCard
          file={msg.file}
          ts={msg.ts}
          ttlHours={imageTtlHours}
          convId={convKey}
          mine={mine}
          onLongPress={() => onLongPress(msg)}
        />
      )}
      {!!msg.edited && <Text style={styles.edited}>{t('message.edited')}</Text>}
      {reactions.length > 0 && (
        <View style={styles.reactions}>
          {reactions.map(([emoji, keys]) => {
            const reacted = !!myKey && keys.includes(myKey)
            return (
              <Pressable
                key={emoji}
                onPress={() => onReact(msg, emoji)}
                style={[styles.reaction, reacted && styles.reactionMine]}
                hitSlop={4}
              >
                <Text style={styles.reactionText}>
                  {emoji} {keys.length}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}
    </Pressable>
  )
}

//& List
interface MessageListProps {
  convKey: string // friend or room: where the reactions, edits and deletions go
  messages: ChatMessage[] // oldest first, as in the store
  myKey?: string
  nameOf: (key: string) => string // author's display name
  empty?: string // shown when there is no message yet
  imageTtlHours?: number // lifetime of shared images (room creator's choice), 0 = never
  onReport?: (msg: ChatMessage) => void // "Report" in the menu of the others' messages (see report.ts)
}

export const MessageList = ({
  convKey,
  messages,
  myKey,
  nameOf,
  empty,
  imageTtlHours = DEFAULT_IMAGE_TTL_HOURS,
  onReport
}: MessageListProps) => {
  const { t } = useTranslation()
  const [sheet, setSheet] = useState<SheetSpec | null>(null)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  // The list is "inverted" (newest at the bottom, scrolled there by default): it wants the newest first
  const newestFirst = useMemo(() => [...messages].reverse(), [messages])

  // Errors (friend offline…) are dropped: the reaction simply does not appear
  const react = (msg: ChatMessage, emoji: string) => {
    const on = !(myKey && msg.reactions?.[emoji]?.includes(myKey))
    void call('react', convKey, msg.id, msg.from, emoji, on).catch(() => {})
  }

  // Long press: the menu of this message (system lines have none)
  const openMenu = (msg: ChatMessage) => {
    const mine = msg.from === myKey
    const actions: SheetSpec['actions'] = []
    if (msg.text) actions.push({ label: t('settings.copy'), onPress: () => Clipboard.setStringAsync(msg.text) })
    if (mine && msg.text) {
      actions.push({
        label: t('message.edit'),
        onPress: () =>
          setPrompt({
            title: t('message.edit'),
            value: msg.text,
            submitLabel: t('roomSettings.save'),
            multiline: true,
            maxLength: 4000,
            onSubmit: (text) => call('editMessage', convKey, msg.id, text)
          })
      })
    }
    if (mine) {
      actions.push({
        label: t('message.delete'),
        danger: true,
        confirm: t('mobile.deleteMessageAsk'),
        onPress: () => call('deleteMessage', convKey, msg.id).catch(() => {})
      })
    }
    if (!mine && onReport) {
      actions.push({
        label: t('report.action'),
        danger: true,
        confirm: t('report.ask', { name: nameOf(msg.from) }),
        onPress: () => onReport(msg)
      })
    }
    setSheet({
      top: (
        <View style={styles.quick}>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                setSheet(null)
                react(msg, emoji)
              }}
              style={({ pressed }) => [styles.quickBtn, pressed && styles.messagePressed]}
              accessibilityLabel={t('message.react')}
            >
              <Text style={styles.quickEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ),
      actions
    })
  }

  return (
    <>
      <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={newestFirst}
      inverted
      keyExtractor={(m) => `${m.from}:${m.id}`}
      // Inverted list: React Native already turns the "empty" component back upright (its style gets the
      // list's inversion transform). Adding our own flip REPLACED that transform: mirrored text on Android
      ListEmptyComponent={empty ? <Text style={styles.system}>{empty}</Text> : undefined}
      renderItem={({ item, index }) => {
        // The list is reversed: the message shown just ABOVE this one is the next item
        const above = newestFirst[index + 1]
        const header =
          !above || above.from !== item.from || item.ts - above.ts > GROUP_MS || !!above.call || !!above.system
        return (
          <Bubble
            msg={item}
            author={nameOf(item.from)}
            mine={item.from === myKey}
            myKey={myKey}
            header={header}
            convKey={convKey}
            imageTtlHours={imageTtlHours}
            onLongPress={openMenu}
            onReact={react}
          />
        )
      }}
      />
      <ActionSheet spec={sheet} onClose={() => setSheet(null)} />
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
    </>
  )
}

//& Styles
const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: space * 1.5, flexGrow: 1 },

  message: { paddingVertical: 2, borderRadius: radius },
  messagePressed: { backgroundColor: colors.bgSoft },
  messageFirst: { marginTop: space * 1.5 },
  meta: { color: colors.textDim, fontSize: 12, marginBottom: 2 },
  author: { color: colors.text, fontWeight: 'bold', fontSize: 14 },
  authorMe: { color: colors.accent },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  edited: { color: colors.textDim, fontSize: 12 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: space / 2, marginTop: space / 2 },
  reaction: {
    paddingHorizontal: space,
    paddingVertical: 2,
    borderRadius: radius * 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgDeep
  },
  reactionMine: { borderColor: colors.accent, backgroundColor: colors.bgSoft },
  reactionText: { color: colors.text, fontSize: 13 },
  quick: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: space },
  quickBtn: { padding: space, borderRadius: radius },
  quickEmoji: { fontSize: 28 },
  system: { color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: space }
})
