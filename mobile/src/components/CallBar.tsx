//* Bar of the call in progress, at the top of the screens (home, chat, room)
// The phone has one window: wherever you are, the bar shows the call, who is in it, who speaks,
// and the buttons (microphone, deafen, loudspeaker, hang up). A tap on the title opens the conversation.
// Also shows the last call error (microphone refused, friend declined…) until it is dismissed.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Avatar as AvatarData, CoreState } from '../../../src/shared/types'
import { useCore } from '../store'
import { participantsOf, useCall } from '../voice/useCall'
import { colors, fonts, radius, space } from '../theme'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'

// Name and picture of a participant (me, a friend or a member of the room)
const personOf = (state: CoreState, key: string, room: string): { name: string; avatar: AvatarData } => {
  if (key === state.me.publicKey) return { name: state.me.name, avatar: state.me.avatar }
  const member = state.rooms.find((r) => r.key === room)?.members.find((m) => m.key === key)
  const person = member ?? state.friends.find((f) => f.key === key)
  return { name: person?.name ?? key.slice(0, 8), avatar: person?.avatar ?? null }
}

export const CallBar = () => {
  const { t } = useTranslation()
  const state = useCore((s) => s.state)
  const { spot, status, speaker, error, lastSpot } = useCall()
  const { leave, setMuted, setDeafened, setSpeaker, clearError, rejoin } = useCall()

  if (!spot) {
    if (!error) return null
    return (
      <Pressable style={styles.error} onPress={clearError}>
        <Text style={styles.errorText}>{error}</Text>
        {/* Call cut without hanging up: one tap to get back in */}
        {lastSpot && (
          <Pressable onPress={rejoin} hitSlop={6} style={({ pressed }) => [styles.rejoin, pressed && styles.pressed]}>
            <Icon name="phone" size={14} color={colors.accent} />
            <Text style={styles.rejoinText}>{t(lastSpot.friendKey ? 'mobile.callBack' : 'mobile.rejoin')}</Text>
          </Pressable>
        )}
        <Icon name="close" size={16} color={colors.textMuted} />
      </Pressable>
    )
  }

  const keys = participantsOf(state, spot)
  const others = keys.filter((k) => k !== state?.me.publicKey)
  const connected = others.filter((k) => status?.links[k] === 'connected').length
  // Line under the title: what the call is waiting for, or how many people are in it
  const line =
    status?.phase !== 'live'
      ? t('mobile.callStarting')
      : others.length === 0
        ? spot.friendKey
          ? t('mobile.callRinging')
          : t('mobile.callAlone')
        : connected < others.length
          ? t('mobile.callConnecting')
          : t('mobile.callPeople', { count: keys.length })

  const open = () =>
    spot.friendKey
      ? router.navigate({ pathname: '/chat/[key]', params: { key: spot.friendKey } })
      : router.navigate({ pathname: '/room/[key]', params: { key: spot.room } })

  const muted = !!status?.muted
  const deafened = !!status?.deafened

  return (
    <View style={styles.bar}>
      <Pressable style={styles.info} onPress={open}>
        <Text style={styles.title} numberOfLines={1}>
          {spot.title}
        </Text>
        <Text style={styles.line} numberOfLines={1}>
          {line}
        </Text>
        {/* Participants: a turquoise ring around those who speak */}
        {state && keys.length > 0 && (
          <View style={styles.people}>
            {keys.map((key) => {
              const person = personOf(state, key, spot.room)
              const speaking = status?.speaking.includes(key)
              return (
                <View key={key} style={[styles.ring, speaking && styles.ringOn]}>
                  <Avatar src={person.avatar} name={person.name} size={24} />
                </View>
              )
            })}
          </View>
        )}
      </Pressable>

      <View style={styles.buttons}>
        <CallButton
          icon={muted ? 'micOff' : 'mic'}
          active={muted}
          label={t(muted ? 'room.unmute' : 'room.mute')}
          onPress={() => setMuted(!muted)}
        />
        <CallButton
          icon={deafened ? 'headphonesOff' : 'headphones'}
          active={deafened}
          label={t(deafened ? 'room.undeafen' : 'room.deafen')}
          onPress={() => setDeafened(!deafened)}
        />
        <CallButton icon="volume" on={speaker} label={t('mobile.speaker')} onPress={() => setSpeaker(!speaker)} />
        <CallButton icon="phone" hangup label={t('room.hangUp')} onPress={leave} />
      </View>
    </View>
  )
}

//& Round button of the bar. active = a "cut" state (red), on = a feature turned on (turquoise)
interface CallButtonProps {
  icon: IconName
  label: string
  onPress: () => void
  active?: boolean
  on?: boolean
  hangup?: boolean
}

const CallButton = ({ icon, label, onPress, active, on, hangup }: CallButtonProps) => (
  <Pressable
    onPress={onPress}
    accessibilityLabel={label}
    hitSlop={4}
    style={({ pressed }) => [
      styles.btn,
      active && styles.btnActive,
      on && styles.btnOn,
      hangup && styles.btnHangup,
      pressed && styles.pressed
    ]}
  >
    {/* The hang-up handset is turned down, as on every phone */}
    <View style={hangup ? styles.handsetDown : undefined}>
      <Icon name={icon} size={20} color={hangup ? colors.text : active ? colors.danger : on ? colors.accent : colors.text} />
    </View>
  </Pressable>
)

//& Styles
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space,
    paddingHorizontal: space * 1.5,
    paddingVertical: space,
    backgroundColor: colors.bgSoft,
    borderBottomColor: colors.accent,
    borderBottomWidth: 1
  },
  info: { flex: 1, minWidth: 0 },
  title: { color: colors.accent, fontFamily: fonts.mono, fontWeight: 'bold' },
  line: { color: colors.textMuted, fontSize: 12 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space / 2, marginTop: space / 2 },
  ring: { borderRadius: 16, borderWidth: 2, borderColor: 'transparent', padding: 1 },
  ringOn: { borderColor: colors.accent },

  buttons: { flexDirection: 'row', gap: space * 0.75 },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: 1
  },
  btnActive: { borderColor: colors.danger },
  btnOn: { borderColor: colors.accent },
  btnHangup: { backgroundColor: colors.danger, borderColor: colors.danger },
  handsetDown: { transform: [{ rotate: '135deg' }] },
  pressed: { opacity: 0.5 },

  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space,
    paddingHorizontal: space * 1.5,
    paddingVertical: space,
    backgroundColor: colors.bgSoft,
    borderBottomColor: colors.danger,
    borderBottomWidth: 1,
    borderRadius: radius
  },
  errorText: { flex: 1, color: colors.text, fontSize: 13 },
  rejoin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space / 2,
    paddingHorizontal: space,
    paddingVertical: space / 2,
    borderRadius: radius,
    borderColor: colors.accent,
    borderWidth: 1
  },
  rejoinText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 12, fontWeight: 'bold' }
})
