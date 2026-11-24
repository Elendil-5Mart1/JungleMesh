//* Room: text channels, voice channels (audio), members
// Mobile counterpart of src/renderer/src/views/RoomView.tsx. The desktop's 3 columns do not fit
// on a phone: the channels become a row of tabs under the header (text, then voice: a tap on a voice
// channel joins it, the call bar appears), and the members (+ invitations) get their own screen
// (MembersScreen), opened from the header.
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Stack } from 'expo-router/stack'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../src/shared/types'
import { call } from '../bridge'
import { sendAnyFile, sendPhoto } from '../files'
import { report } from '../report'
import { CallBar } from '../components/CallBar'
import { Composer } from '../components/Composer'
import { Icon } from '../components/Icon'
import { ActionSheet, Prompt, type PromptSpec, type SheetSpec } from '../components/Sheet'
import { MessageList } from '../components/MessageList'
import { useCore } from '../store'
import { useOnScreen } from '../useOnScreen'
import { useCall } from '../voice/useCall'
import { colors, fonts, radius, space } from '../theme'

const NO_MESSAGES: ChatMessage[] = [] // stable empty list (a new [] would re-render on every store change)

// Channel of a message ('general' if missing: old messages, system messages), as on the desktop
const channelOf = (m: ChatMessage): string => m.channel ?? 'general'

//& Screen
export const RoomScreen = ({ roomKey }: { roomKey: string }) => {
  const { t } = useTranslation()
  const me = useCore((s) => s.state?.me)
  const room = useCore((s) => s.state?.rooms.find((r) => r.key === roomKey))
  const friends = useCore((s) => s.state?.friends)
  const messages = useCore((s) => s.messages[roomKey] ?? NO_MESSAGES)
  const loadHistory = useCore((s) => s.loadHistory)
  const headerHeight = useHeaderHeight()
  const [channelId, setChannelId] = useState('general')
  const [sheet, setSheet] = useState<SheetSpec | null>(null)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  // Number of messages already seen per channel → the other tabs show a dot (as the desktop's bold channels)
  const [seen, setSeen] = useState<Record<string, number>>({})
  const callSpot = useCall((s) => s.spot)
  const joinCall = useCall((s) => s.join)
  useOnScreen(roomKey)

  // History reloads when the status changes ("joining" → "joined": the members' logs become readable)
  useEffect(() => {
    void loadHistory(roomKey)
  }, [roomKey, room?.status, loadHistory])

  // Only the messages of the open channel (recomputed when the list or the channel changes)
  const shown = useMemo(() => messages.filter((m) => channelOf(m) === channelId), [messages, channelId])

  // Messages counted per channel (recomputed only when the list changes)
  const countByChannel = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of messages) counts[channelOf(m)] = (counts[channelOf(m)] ?? 0) + 1
    return counts
  }, [messages])

  // The open channel is always "seen"; on first load, everything is considered seen
  useEffect(() => {
    setSeen((prev) => {
      const next = { ...prev, [channelId]: countByChannel[channelId] ?? 0 }
      for (const id of Object.keys(countByChannel)) next[id] ??= countByChannel[id]
      return next
    })
  }, [countByChannel, channelId])

  if (!room) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.muted}>{t('room.notFound')}</Text>
      </View>
    )
  }

  const textChannels = room.channels.filter((c) => c.kind === 'text')
  const voiceChannels = room.channels.filter((c) => c.kind === 'voice')
  // Selected channel deleted meanwhile → back to the first text channel
  const channel = textChannels.find((c) => c.id === channelId) ?? textChannels[0]
  const joined = room.status === 'joined'
  const online = room.members.filter((m) => m.online).length

  const nameOf = (key: string) => room.members.find((m) => m.key === key)?.name ?? key.slice(0, 8)

  //& Channels: only the room's creator manages them (the core checks it too), #general stays
  const createChannel = () =>
    setPrompt({
      title: t('mobile.newChannel'),
      placeholder: t('room.newTextName'),
      submitLabel: t('home.create'),
      maxLength: 32,
      onSubmit: (name) => call('createChannel', roomKey, name, 'text')
    })

  const channelMenu = (id: string, name: string) =>
    setSheet({
      title: `#${name}`,
      actions: [
        {
          label: t('menu.renameChannel'),
          onPress: () =>
            setPrompt({
              title: t('menu.renameChannel'),
              value: name,
              submitLabel: t('roomSettings.save'),
              maxLength: 32,
              onSubmit: (next) => call('renameChannel', roomKey, id, next)
            })
        },
        {
          label: t('menu.deleteChannel'),
          danger: true,
          confirm: t('mobile.deleteChannelAsk', { name }),
          onPress: () => call('deleteChannel', roomKey, id).catch(() => {})
        }
      ]
    })

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

      {/* Text channels: horizontal tabs (always shown to the creator: the "+" creates a channel,
          a long press on a tab renames or deletes it) */}
      <CallBar />

      {(textChannels.length > 1 || room.isOwner || voiceChannels.length > 0) && (
        <View style={styles.tabsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {textChannels.map((c) => {
              const active = c.id === channel?.id
              const unseen = !active && (countByChannel[c.id] ?? 0) > (seen[c.id] ?? 0)
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setChannelId(c.id)}
                  onLongPress={room.isOwner && c.id !== 'general' ? () => channelMenu(c.id, c.name) : undefined}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive, unseen && styles.tabTextUnseen]}>#{c.name}</Text>
                  {unseen && <View style={styles.unseenDot} />}
                </Pressable>
              )
            })}
            {/* Voice channels: loudspeaker + how many people are in it; tap = join */}
            {joined &&
              voiceChannels.map((c) => {
                const inIt = callSpot?.room === roomKey && callSpot.chan === c.id
                const count = room.voice[c.id]?.length ?? 0
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => !inIt && void joinCall({ room: roomKey, chan: c.id, title: `${room.name} › ${c.name}` })}
                    onLongPress={room.isOwner ? () => channelMenu(c.id, c.name) : undefined}
                    accessibilityLabel={t('call.join')}
                    style={[styles.tab, inIt && styles.tabActive]}
                  >
                    <Icon name="volume" size={16} color={inIt || count > 0 ? colors.accent : colors.textMuted} />
                    <Text style={[styles.tabText, inIt && styles.tabTextActive]}>{c.name}</Text>
                    {count > 0 && <Text style={styles.voiceCount}>{count}</Text>}
                  </Pressable>
                )
              })}
            {room.isOwner && (
              <Pressable onPress={createChannel} style={styles.tab} accessibilityLabel={t('room.createText')}>
                <Text style={styles.tabTextActive}>+</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}

      {!joined && <Text style={styles.banner}>{t('room.waitingEnroll')}</Text>}

      <MessageList
        convKey={roomKey}
        messages={channel ? shown : NO_MESSAGES}
        myKey={me?.publicKey}
        nameOf={nameOf}
        empty={channel ? t('room.channelStart', { name: channel.name }) : undefined}
        imageTtlHours={room.imageTtl}
        onReport={(msg) =>
          void report({
            key: msg.from,
            name: nameOf(msg.from),
            where: `#${room.name}`,
            friend: !!friends?.some((f) => f.key === msg.from && f.status === 'accepted'),
            msg
          })
        }
      />

      <Composer
        placeholder={joined && channel ? t('room.sendIn', { name: channel.name }) : t('room.enrolling')}
        disabled={!joined || !channel}
        onSend={(text) => call('send', roomKey, text, channel?.id)}
        onAttach={(kind) => (kind === 'photo' ? sendPhoto(roomKey, channel?.id) : sendAnyFile(roomKey, channel?.id))}
      />
      <ActionSheet spec={sheet} onClose={() => setSheet(null)} />
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space / 2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space / 2
  },
  tabActive: { borderColor: colors.accent, backgroundColor: colors.bgSoft },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.accent },
  tabTextUnseen: { color: colors.text, fontWeight: 'bold' },
  unseenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  voiceCount: { color: colors.accent, fontFamily: fonts.mono, fontSize: 12 },

  banner: {
    color: colors.warn,
    fontSize: 12,
    paddingHorizontal: space * 1.5,
    paddingVertical: space,
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  }
})
