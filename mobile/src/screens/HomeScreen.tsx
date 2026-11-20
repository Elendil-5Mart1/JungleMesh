//* Home screen: my profile, my invite code, friends and friend requests
// Mobile counterpart of src/renderer/src/views/HomeView.tsx, reusing its texts (home.*).
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { Trans, useTranslation } from 'react-i18next'
import type { Friend, Room } from '../../../src/shared/types'
import { call } from '../bridge'
import { Button } from '../components/Button'
import { useCore } from '../store'
import { colors, fonts, radius, space } from '../theme'

//& One line of the friends list
const FriendRow = ({ friend }: { friend: Friend }) => {
  const { t } = useTranslation()
  const dot = friend.online ? colors.accent : colors.textDim

  // An accepted friend opens the conversation; a request stays a plain line with its buttons
  const open = friend.status === 'accepted' ? () => router.push({ pathname: '/chat/[key]', params: { key: friend.key } }) : undefined

  return (
    <Pressable style={({ pressed }) => [styles.friend, pressed && !!open && styles.friendPressed]} onPress={open} disabled={!open}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={styles.friendBody}>
        {friend.status === 'incoming' ? (
          <Text style={styles.friendName}>
            <Trans i18nKey="home.wantsToAdd" values={{ name: friend.name }} components={{ strong: <Text style={styles.strong} /> }} />
          </Text>
        ) : (
          <Text style={styles.friendName}>{friend.name}</Text>
        )}
        {friend.status === 'outgoing' && <Text style={styles.muted}>{t('home.pending')}</Text>}
      </View>
      {friend.status === 'incoming' && (
        <View style={styles.row}>
          <Button label={t('home.accept')} kind="primary" onPress={() => call('acceptRequest', friend.key)} />
          <Button label={t('home.decline')} kind="danger" onPress={() => call('declineRequest', friend.key)} />
        </View>
      )}
    </Pressable>
  )
}

//& One line of the rooms list (joined or being joined)
const openRoom = (key: string) => router.push({ pathname: '/room/[key]', params: { key } })

const RoomRow = ({ room }: { room: Room }) => {
  const { t } = useTranslation()
  return (
    <Pressable style={({ pressed }) => [styles.friend, pressed && styles.friendPressed]} onPress={() => openRoom(room.key)}>
      <Text style={styles.hash}>#</Text>
      <View style={styles.friendBody}>
        <Text style={styles.friendName}>{room.name}</Text>
        {room.status === 'joining' && <Text style={styles.muted}>{t('home.joining')}</Text>}
      </View>
    </Pressable>
  )
}

//& Screen
export const HomeScreen = () => {
  const { t } = useTranslation()
  const state = useCore((s) => s.state)
  const bootError = useCore((s) => s.error)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [roomName, setRoomName] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  // The name field follows the core (but not while the user is typing in it)
  const savedName = state?.me.named ? state.me.name : ''
  useEffect(() => setName(savedName), [savedName])

  if (bootError) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.error}>{bootError}</Text>
      </SafeAreaView>
    )
  }

  if (!state) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted}>{t('home.connecting')}</Text>
      </SafeAreaView>
    )
  }

  const { me, friends, rooms } = state
  const invites = rooms.filter((r) => r.status === 'invited')
  const myRooms = rooms.filter((r) => r.status !== 'invited')
  const link = `junglemesh://add/${me.inviteCode}`

  // Runs a core call and shows its error under the form (invalid code, own code…)
  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveName = () => {
    const clean = name.trim()
    if (clean && clean !== me.name) void run(() => call('setName', clean))
  }

  const copyCode = async () => {
    await Clipboard.setStringAsync(me.inviteCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const addFriend = () => {
    if (!code.trim()) return
    void run(async () => {
      await call('addFriend', code)
      setCode('')
    })
  }

  // Created then opened, as on the desktop
  const createRoom = () => {
    const clean = roomName.trim()
    if (!clean) return
    void run(async () => {
      const key = await call<string>('createRoom', clean)
      setRoomName('')
      openRoom(key)
    })
  }

  const joinRoom = (key: string) =>
    void run(async () => {
      await call('acceptRoomInvite', key)
      openRoom(key)
    })

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>JungleMesh</Text>

        {/* Profile */}
        <Text style={styles.label}>{t('settings.name')}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          onEndEditing={saveName}
          placeholder={t('welcome.namePlaceholder')}
          placeholderTextColor={colors.textDim}
          maxLength={32}
          returnKeyType="done"
        />

        {/* Invite code */}
        <Text style={styles.label}>{t('settings.inviteCode')}</Text>
        <Text style={styles.code} selectable>
          {me.inviteCode}
        </Text>
        <Text style={styles.hint}>{t('settings.inviteCodeHint')}</Text>
        <View style={styles.row}>
          <Button label={copied ? t('settings.copied') : t('settings.copy')} onPress={copyCode} />
          <Button label={t('settings.share')} onPress={() => Share.share({ message: link })} />
        </View>

        {/* Add a friend */}
        <Text style={styles.label}>{t('home.addFriend')}</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={addFriend}
          placeholder={t('home.friendCode')}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label={t('home.sendRequest')} kind="primary" onPress={addFriend} disabled={!code.trim()} />
        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* Room invitations */}
        {invites.map((r) => (
          <View key={r.key} style={styles.invite}>
            <Text style={styles.friendName}>
              <Trans
                i18nKey="home.invitesYou"
                values={{ who: r.invitedBy, room: r.name }}
                components={{ strong: <Text style={styles.strong} /> }}
              />
            </Text>
            <View style={styles.row}>
              <Button label={t('home.join')} kind="primary" onPress={() => joinRoom(r.key)} />
              <Button label={t('home.decline')} kind="danger" onPress={() => void run(() => call('declineRoomInvite', r.key))} />
            </View>
          </View>
        ))}

        {/* Rooms */}
        <Text style={styles.label}>{t('home.rooms')}</Text>
        <View style={styles.inline}>
          <TextInput
            style={[styles.input, styles.grow]}
            value={roomName}
            onChangeText={setRoomName}
            onSubmitEditing={createRoom}
            placeholder={t('home.roomName')}
            placeholderTextColor={colors.textDim}
            maxLength={64}
            returnKeyType="done"
          />
          <Button label={t('home.create')} onPress={createRoom} disabled={!roomName.trim()} />
        </View>
        {myRooms.length === 0 ? (
          <Text style={styles.muted}>{t('mobile.noRooms')}</Text>
        ) : (
          myRooms.map((r) => <RoomRow key={r.key} room={r} />)
        )}

        {/* Friends */}
        <Text style={styles.label}>{t('home.friends')}</Text>
        {friends.length === 0 ? (
          <Text style={styles.muted}>{t('mobile.noFriends')}</Text>
        ) : (
          friends.map((f) => <FriendRow key={f.key} friend={f} />)
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space * 2, padding: space * 3 },
  content: { padding: space * 2, gap: space },
  title: { color: colors.accent, fontFamily: fonts.mono, fontSize: 22, marginBottom: space },
  label: {
    color: colors.textDim,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: space * 2
  },
  input: {
    backgroundColor: colors.bgDeep,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  code: {
    color: colors.accent,
    fontFamily: fonts.mono,
    backgroundColor: colors.bgDeep,
    padding: space * 1.5,
    borderRadius: radius
  },
  hint: { color: colors.textMuted, fontSize: 12 },
  muted: { color: colors.textMuted },
  error: { color: colors.danger },
  strong: { fontWeight: 'bold', color: colors.text },
  row: { flexDirection: 'row', gap: space, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', gap: space, alignItems: 'center' },
  grow: { flex: 1 },
  invite: {
    gap: space,
    padding: space * 1.5,
    marginTop: space,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: colors.bgSoft
  },
  hash: { color: colors.textDim, fontFamily: fonts.mono, fontSize: 16, width: 10, textAlign: 'center' },

  friend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space * 1.5,
    paddingVertical: space,
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  },
  friendBody: { flex: 1 },
  friendName: { color: colors.text, fontSize: 16 },
  friendPressed: { backgroundColor: colors.bgSoft },
  dot: { width: 10, height: 10, borderRadius: 5 }
})
