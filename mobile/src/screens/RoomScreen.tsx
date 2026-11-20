//* Room (step 2b: text channels only)
// Mobile counterpart of src/renderer/src/views/RoomView.tsx. The desktop's 3 columns do not fit
// on a phone: the text channels become a row of tabs under the header, and the members
// (+ invitations) get their own screen (MembersScreen), opened from the header.
// Voice channels are not shown yet (calls come later on mobile).
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Stack } from 'expo-router/stack'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../src/shared/types'
import { call } from '../bridge'
import { Composer } from '../components/Composer'
import { MessageList } from '../components/MessageList'
import { useCore } from '../store'
import { colors, fonts, radius, space } from '../theme'

const NO_MESSAGES: ChatMessage[] = [] // stable empty list (a new [] would re-render on every store change)

// Channel of a message ('general' if missing: old messages, system messages), as on the desktop
const channelOf = (m: ChatMessage): string => m.channel ?? 'general'

//& Screen
export const RoomScreen = ({ roomKey }: { roomKey: string }) => {
  const { t } = useTranslation()
  const me = useCore((s) => s.state?.me)
  const room = useCore((s) => s.state?.rooms.find((r) => r.key === roomKey))
  const messages = useCore((s) => s.messages[roomKey] ?? NO_MESSAGES)
  const loadHistory = useCore((s) => s.loadHistory)
  const headerHeight = useHeaderHeight()
  const [channelId, setChannelId] = useState('general')

  // History reloads when the status changes ("joining" → "joined": the members' logs become readable)
  useEffect(() => {
    void loadHistory(roomKey)
  }, [roomKey, room?.status, loadHistory])

  // Only the messages of the open channel (recomputed when the list or the channel changes)
  const shown = useMemo(() => messages.filter((m) => channelOf(m) === channelId), [messages, channelId])

  if (!room) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.muted}>{t('room.notFound')}</Text>
      </View>
    )
  }

  const textChannels = room.channels.filter((c) => c.kind === 'text')
  // Selected channel deleted meanwhile → back to the first text channel
  const channel = textChannels.find((c) => c.id === channelId) ?? textChannels[0]
  const joined = room.status === 'joined'
  const online = room.members.filter((m) => m.online).length

  const nameOf = (key: string) => room.members.find((m) => m.key === key)?.name ?? key.slice(0, 8)

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Stack.Screen
        options={{
          title: room.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/room/[key]/members', params: { key: roomKey } })}
              style={({ pressed }) => [styles.membersBtn, pressed && styles.pressed]}
              hitSlop={8}
            >
              <Text style={styles.membersText}>{t('room.onlineCount', { online, total: room.members.length })}</Text>
            </Pressable>
          )
        }}
      />

      {/* Text channels: horizontal tabs */}
      {textChannels.length > 1 && (
        <View style={styles.tabsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {textChannels.map((c) => {
              const active = c.id === channel?.id
              return (
                <Pressable key={c.id} onPress={() => setChannelId(c.id)} style={[styles.tab, active && styles.tabActive]}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>#{c.name}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}

      {!joined && <Text style={styles.banner}>{t('room.waitingEnroll')}</Text>}

      <MessageList
        messages={channel ? shown : NO_MESSAGES}
        myKey={me?.publicKey}
        nameOf={nameOf}
        empty={channel ? t('room.channelStart', { name: channel.name }) : undefined}
      />

      <Composer
        placeholder={joined && channel ? t('room.sendIn', { name: channel.name }) : t('room.enrolling')}
        disabled={!joined || !channel}
        onSend={(text) => call('send', roomKey, text, channel?.id)}
      />
    </KeyboardAvoidingView>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.textMuted },
  pressed: { opacity: 0.5 },

  membersBtn: { paddingHorizontal: space, paddingVertical: space / 2 },
  membersText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 12 },

  tabsBar: { borderBottomColor: colors.line, borderBottomWidth: 1 },
  tabs: { gap: space, paddingHorizontal: space * 1.5, paddingVertical: space },
  tab: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space / 2
  },
  tabActive: { borderColor: colors.accent, backgroundColor: colors.bgSoft },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.accent },

  banner: {
    color: colors.warn,
    fontSize: 12,
    paddingHorizontal: space * 1.5,
    paddingVertical: space,
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  }
})
