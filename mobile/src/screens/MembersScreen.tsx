//* Members of a room + inviting friends
// On the desktop these are the right column and the "invite" panel of RoomView;
// on a phone they get their own screen, opened from the room's header.
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router/stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import type { RoomMember } from '../../../src/shared/types'
import { call } from '../bridge'
import { Button } from '../components/Button'
import { useCore } from '../store'
import { colors, space } from '../theme'

//& One member
const MemberRow = ({ member, me }: { member: RoomMember; me: boolean }) => {
  const { t } = useTranslation()
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: member.online ? colors.accent : colors.textDim }]} />
      <Text style={[styles.name, !member.online && styles.offline]}>
        {member.name}
        {me && <Text style={styles.muted}> {t('roomSettings.you')}</Text>}
      </Text>
      {member.isOwner && <Text style={styles.owner}>{t('room.owner')}</Text>}
    </View>
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

  const invite = async (friendKey: string) => {
    setError('')
    try {
      await call('inviteToRoom', roomKey, friendKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: space * 2 + insets.bottom }]}>
      <Stack.Screen options={{ title: room.name }} />

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
                <MemberRow key={m.key} member={m} me={m.key === myKey} />
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
  error: { color: colors.danger }
})
