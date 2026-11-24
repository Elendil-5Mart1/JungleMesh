//* Members of a room + inviting friends + the room's settings
// On the desktop these are the right column, the "invite" panel and the settings panel of RoomView;
// on a phone they get their own screen, opened from the room's header (or a long press on the room).
// The creator also sets the room's picture and name, and removes a member with a long press.
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { Stack } from 'expo-router/stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { IMAGE_TTL_CHOICES, type RoomMember } from '../../../src/shared/types'
import { pickAvatar } from '../avatar'
import { call } from '../bridge'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Choice } from '../components/Choice'
import { useCore } from '../store'
import { colors, radius, space } from '../theme'

//& One member
const MemberRow = ({ member, me, onLongPress }: { member: RoomMember; me: boolean; onLongPress?: () => void }) => {
  const { t } = useTranslation()
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && !!onLongPress && styles.pressed]} onLongPress={onLongPress}>
      <View style={[styles.dot, { backgroundColor: member.online ? colors.accent : colors.textDim }]} />
      <Text style={[styles.name, !member.online && styles.offline]}>
        {member.name}
        {me && <Text style={styles.muted}> {t('roomSettings.you')}</Text>}
      </Text>
      {member.isOwner && <Text style={styles.owner}>{t('room.owner')}</Text>}
    </Pressable>
  )
}

//& Screen
export const MembersScreen = ({ roomKey }: { roomKey: string }) => {
  const { t } = useTranslation()
  const myKey = useCore((s) => s.state?.me.publicKey)
  const room = useCore((s) => s.state?.rooms.find((r) => r.key === roomKey))
  const friends = useCore((s) => s.state?.friends)
  const insets = useSafeAreaInsets()
  const [error, setError] = useState('')

  if (!room || !friends) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.muted}>{t('room.notFound')}</Text>
      </View>
    )
  }

  const online = room.members.filter((m) => m.online)
  const offline = room.members.filter((m) => !m.online)
  // Invitable friends: accepted, neither members nor already invited (same rule as the desktop)
  const invitable = friends.filter(
    (f) => f.status === 'accepted' && !room.members.some((m) => m.key === f.key) && !room.pendingInvites.includes(f.key)
  )
  const pending = friends.filter((f) => room.pendingInvites.includes(f.key))

  // Runs a core call and shows its error
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError('')
    try {
      await action()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  const invite = (friendKey: string) => run(() => call('inviteToRoom', roomKey, friendKey))

  // Creator: remove a member (system confirmation, as the desktop's second click)
  const kick = (m: RoomMember) =>
    Alert.alert(t('mobile.kickAsk', { name: m.name }), t('roomSettings.kickHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('roomSettings.kick'), style: 'destructive', onPress: () => void run(() => call('kickFromRoom', roomKey, m.key)) }
    ])

  // Leave (member) or delete for everyone (creator), then back to the home screen
  const quit = () => {
    const owner = room.isOwner
    Alert.alert(
      owner ? t('roomSettings.deleteRoomAsk', { name: room.name }) : t('roomSettings.leaveAsk', { name: room.name }),
      owner ? t('roomSettings.deleteRoomHint') : t('roomSettings.leaveHint'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: owner ? t('roomSettings.deleteRoomYes') : t('roomSettings.leaveYes'),
          style: 'destructive',
          onPress: () =>
            void run(() => call(owner ? 'deleteRoom' : 'leaveRoom', roomKey)).then((ok) => ok && router.dismissTo('/'))
        }
      ]
    )
  }

  const changePicture = () =>
    void run(async () => {
      const avatar = await pickAvatar()
      if (avatar) await call('setRoomAvatar', roomKey, avatar)
    })

  const rename = (value: string) => {
    const name = value.trim()
    if (name && name !== room.name) void run(() => call('renameRoom', roomKey, name))
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: space * 2 + insets.bottom }]}>
      <Stack.Screen options={{ title: room.name }} />

      {/* Room settings: the creator changes them, the others just see them */}
      <View style={styles.roomHead}>
        <Pressable onPress={room.isOwner ? changePicture : undefined} disabled={!room.isOwner}>
          <Avatar src={room.avatar} name={room.name} size={64} />
        </Pressable>
        {room.isOwner ? (
          <View style={styles.roomSide}>
            <TextInput
              key={room.name}
              style={styles.field}
              defaultValue={room.name}
              maxLength={64}
              returnKeyType="done"
              onEndEditing={(e) => rename(e.nativeEvent.text)}
              accessibilityLabel={t('roomSettings.roomName')}
            />
            <Text style={styles.hint}>{t('mobile.roomPictureHint')}</Text>
          </View>
        ) : (
          <Text style={styles.roomName}>{room.name}</Text>
        )}
      </View>

      {/* Lifetime of the images shared in the room: the creator's choice applies to every member */}
      <Text style={styles.label}>{t('roomSettings.imageTtl')}</Text>
      {room.isOwner ? (
        <Choice<number | null>
          options={[
            { value: null, label: t('roomSettings.imageTtlDefault') },
            ...IMAGE_TTL_CHOICES.map((hours) => ({ value: hours, label: t(`ttl.${hours}`) }))
          ]}
          value={room.imageTtl ?? null}
          onChange={(hours) => void run(() => call('setRoomImageTtl', roomKey, hours))}
        />
      ) : (
        <Text style={styles.name}>
          {room.imageTtl === undefined ? t('roomSettings.imageTtlDefault') : t(`ttl.${room.imageTtl}`)}
        </Text>
      )}
      <Text style={styles.hint}>{t('roomSettings.imageTtlHint')}</Text>

      {/* Members, online first */}
      {[
        { title: t('room.online'), list: online },
        { title: t('room.offline'), list: offline }
      ].map(
        ({ title, list }) =>
          list.length > 0 && (
            <View key={title}>
              <Text style={styles.label}>
                {title} — {list.length}
              </Text>
              {list.map((m) => (
                <MemberRow
                  key={m.key}
                  member={m}
                  me={m.key === myKey}
                  onLongPress={room.isOwner && m.key !== myKey && !m.isOwner ? () => kick(m) : undefined}
                />
              ))}
            </View>
          )
      )}

      {/* Invitations */}
      <Text style={styles.label}>{t('room.inviteFriends')}</Text>
      {invitable.length === 0 && <Text style={styles.muted}>{t('room.allInvited')}</Text>}
      {invitable.map((f) => (
        <View key={f.key} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: f.online ? colors.accent : colors.textDim }]} />
          <Text style={styles.name}>{f.name}</Text>
          <Button label={t('mobile.invite')} onPress={() => void invite(f.key)} />
        </View>
      ))}
      {pending.length > 0 && (
        <Text style={styles.hint}>
          {t('room.pendingInvites', { names: pending.map((f) => f.name).join(', ') })}
          {pending.some((f) => !f.online) && ` ${t('room.pendingOffline')}`}
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.quit}>
        <Button
          label={room.isOwner ? t('roomSettings.deleteRoom') : t('roomSettings.leaveRoom')}
          kind="danger"
          onPress={quit}
        />
      </View>
    </ScrollView>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: space * 2, gap: space },
  label: {
    color: colors.textDim,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: space * 2,
    marginBottom: space / 2
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space * 1.5,
    paddingVertical: space,
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: colors.text, fontSize: 16 },
  offline: { color: colors.textMuted },
  owner: { color: colors.warn, fontSize: 12 },
  muted: { color: colors.textMuted },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: space },
  error: { color: colors.danger },
  pressed: { backgroundColor: colors.bgSoft },
  roomHead: { flexDirection: 'row', alignItems: 'center', gap: space * 2 },
  roomSide: { flex: 1, gap: space / 2 },
  roomName: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '600' },
  field: {
    color: colors.text,
    fontSize: 17,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  quit: { marginTop: space * 4, alignItems: 'flex-start' }
})
