//* Invite link received (junglemesh://add/<code>): never added without confirmation, as on the desktop
// Mobile counterpart of the "Invitation received" block of src/renderer/src/views/HomeView.tsx (same texts).
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { Trans, useTranslation } from 'react-i18next'
import { call } from '../bridge'
import { Button } from '../components/Button'
import { useCore } from '../store'
import { colors, fonts, radius, space } from '../theme'

// Back to the home screen, whether the app was already open or started by the link
const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'))

export const AddFriendScreen = ({ code }: { code: string }) => {
  const { t } = useTranslation()
  const ready = useCore((s) => s.state !== null)
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const clean = String(code ?? '').trim()

  // The core checks the code (format, my own code, already a friend…) and its error is shown as is
  const add = async () => {
    setBusy(true)
    setError('')
    try {
      await call('addFriend', clean, nickname.trim())
      goHome()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t('home.inviteReceived') }} />
      {!ready ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Text style={styles.text}>
            <Trans
              i18nKey="home.inviteAsk"
              values={{ code: `${clean.slice(0, 8)}…${clean.slice(-4)}` }}
              components={{ code: <Text style={styles.code} /> }}
            />
          </Text>
          <TextInput
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder={t('home.nicknameOptional')}
            placeholderTextColor={colors.textDim}
            maxLength={64}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.row}>
            <Button label={t('home.add')} kind="primary" onPress={() => void add()} disabled={busy || !clean} />
            <Button label={t('home.ignore')} onPress={goHome} />
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space * 2, gap: space * 1.5 },
  text: { color: colors.text, fontSize: 16 },
  code: { color: colors.accent, fontFamily: fonts.mono },
  input: {
    color: colors.text,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  error: { color: colors.danger },
  row: { flexDirection: 'row', gap: space }
})
