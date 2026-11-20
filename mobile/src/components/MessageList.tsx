//* Message list shared by the DM and room screens (text only for now)
// Mobile counterpart of src/renderer/src/components/MessageList.tsx. Markdown, files, reactions
// and editing come later: the text is shown as is.
import { useMemo } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../src/shared/types'
import { colors, space } from '../theme'

const GROUP_MS = 5 * 60_000 // consecutive messages of the same author within 5 min share one header

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// System lines are written in Markdown ("**Alice** joined the room"): without a Markdown renderer
// yet, the bold markers are simply removed
const plain = (text: string) => text.replace(/\*\*/g, '')

//& One message
interface BubbleProps {
  msg: ChatMessage
  author: string
  mine: boolean
  header: boolean // first of a group: show the author and the time
}

const Bubble = ({ msg, author, mine, header }: BubbleProps) => {
  const { t } = useTranslation()

  // Call event written in the history (only "declined" for now): a system line
  if (msg.call) return <Text style={styles.system}>{t('call.declined', { name: author })}</Text>
  // System message of a room ("X joined the room"): a discreet, centered line
  if (msg.system) return <Text style={styles.system}>{plain(msg.text)}</Text>

  return (
    <View style={[styles.message, header && styles.messageFirst]}>
      {header && (
        <Text style={styles.meta}>
          <Text style={[styles.author, mine && styles.authorMe]}>{author}</Text>
          {'  '}
          {time(msg.ts)}
        </Text>
      )}
      <Text style={styles.text} selectable>
        {msg.file ? `📎 ${msg.file.name}${msg.text ? `\n${msg.text}` : ''}` : msg.text}
        {msg.edited ? <Text style={styles.edited}> {t('message.edited')}</Text> : null}
      </Text>
    </View>
  )
}

//& List
interface MessageListProps {
  messages: ChatMessage[] // oldest first, as in the store
  myKey?: string
  nameOf: (key: string) => string // author's display name
  empty?: string // shown when there is no message yet
}

export const MessageList = ({ messages, myKey, nameOf, empty }: MessageListProps) => {
  // The list is "inverted" (newest at the bottom, scrolled there by default): it wants the newest first
  const newestFirst = useMemo(() => [...messages].reverse(), [messages])

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={newestFirst}
      inverted
      keyExtractor={(m) => `${m.from}:${m.id}`}
      // Inverted list: the "empty" component is drawn upside down too, it is flipped back
      ListEmptyComponent={empty ? <Text style={[styles.system, styles.flip]}>{empty}</Text> : undefined}
      renderItem={({ item, index }) => {
        // The list is reversed: the message shown just ABOVE this one is the next item
        const above = newestFirst[index + 1]
        const header =
          !above || above.from !== item.from || item.ts - above.ts > GROUP_MS || !!above.call || !!above.system
        return <Bubble msg={item} author={nameOf(item.from)} mine={item.from === myKey} header={header} />
      }}
    />
  )
}

//& Styles
const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: space * 1.5, flexGrow: 1 },
  flip: { transform: [{ scaleY: -1 }] },

  message: { paddingVertical: 2 },
  messageFirst: { marginTop: space * 1.5 },
  meta: { color: colors.textDim, fontSize: 12, marginBottom: 2 },
  author: { color: colors.text, fontWeight: 'bold', fontSize: 14 },
  authorMe: { color: colors.accent },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  edited: { color: colors.textDim, fontSize: 12 },
  system: { color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: space }
})
