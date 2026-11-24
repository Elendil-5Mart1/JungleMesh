//* Incoming 1-to-1 call: a full-screen card over any screen, with the phone's ringtone
// Mobile counterpart of the desktop's IncomingCallView popup. A friend "calls" by joining our shared
// call (Friend.call lists them, not me): no separate "ring" message, as on the desktop.
// Only while the app is open: ringing with the app closed needs notifications (not done on mobile).
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import InCallManager from 'react-native-incall-manager'
import { useTranslation } from 'react-i18next'
import { call } from '../bridge'
import { useCore } from '../store'
import { useCall } from '../voice/useCall'
import { colors, fonts, space } from '../theme'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

const RING_SECONDS = 45 // the ringtone stops by itself after that (the card stays until the caller hangs up)

export const IncomingCall = () => {
  const { t } = useTranslation()
  const state = useCore((s) => s.state)
  const spot = useCall((s) => s.spot)
  const join = useCall((s) => s.join)
  // Calls I declined or that I let ring out: hidden until the caller hangs up (then calls again)
  const [dismissed, setDismissed] = useState<string[]>([])

  const me = state?.me.publicKey
  // Friends waiting in our call, without me in it
  const calling = useMemo(
    () =>
      state?.friends.filter(
        (f) => f.status === 'accepted' && f.call.includes(f.key) && !!me && !f.call.includes(me) && spot?.room !== f.callId
      ) ?? [],
    [state, me, spot]
  )

  // A caller who hung up can ring again later
  useEffect(() => {
    setDismissed((prev) => {
      const next = prev.filter((key) => calling.some((f) => f.key === key))
      return next.length === prev.length ? prev : next
    })
  }, [calling])

  const caller = calling.find((f) => !dismissed.includes(f.key))

  // Ringtone of the phone (the user's own, from Android's settings) while the card is shown
  useEffect(() => {
    if (!caller) return
    InCallManager.startRingtone('_DEFAULT_', 0, '', RING_SECONDS) // 0 = no vibration (not an array)
    return () => InCallManager.stopRingtone()
  }, [caller?.key])

  if (!caller) return null

  const accept = () => {
    setDismissed((prev) => [...prev, caller.key])
    router.navigate({ pathname: '/chat/[key]', params: { key: caller.key } })
    void join({ room: caller.callId, chan: 'dm', friendKey: caller.key, title: caller.name })
  }

  // The caller is told (they hang up), and "X declined the call" goes into the conversation
  const decline = () => {
    setDismissed((prev) => [...prev, caller.key])
    void call('declineCall', caller.key).catch(() => {})
  }

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={decline}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Avatar src={caller.avatar} name={caller.name} size={96} cutout={colors.bgSoft} />
          <Text style={styles.title}>{t('call.incoming', { name: caller.name })}</Text>
          {spot && <Text style={styles.hint}>{t('mobile.callReplaces', { title: spot.title })}</Text>}
          <View style={styles.actions}>
            <Pressable style={({ pressed }) => [styles.round, styles.decline, pressed && styles.pressed]} onPress={decline}>
              <View style={styles.handsetDown}>
                <Icon name="phone" size={28} />
              </View>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.round, styles.accept, pressed && styles.pressed]} onPress={accept}>
              <Icon name="phone" size={28} color={colors.onAccent} />
            </Pressable>
          </View>
          <View style={styles.labels}>
            <Text style={styles.label}>{t('call.decline')}</Text>
            <Text style={styles.label}>{t('call.join')}</Text>
          </View>
        </View>
      </View>
    </Modal>
  )
}

//& Styles
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(7, 9, 13, 0.92)', alignItems: 'center', justifyContent: 'center', padding: space * 2 },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: space * 2,
    padding: space * 3,
    backgroundColor: colors.bgSoft,
    borderColor: colors.accent,
    borderWidth: 1
  },
  title: { color: colors.text, fontFamily: fonts.mono, fontSize: 18, textAlign: 'center' },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', marginTop: space },
  labels: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  label: { color: colors.textMuted, fontSize: 12, width: 96, textAlign: 'center' },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: colors.danger },
  accept: { backgroundColor: colors.accent },
  handsetDown: { transform: [{ rotate: '135deg' }] },
  pressed: { opacity: 0.6 }
})
