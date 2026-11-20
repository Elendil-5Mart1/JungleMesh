//* Settings (gear of the home screen)
// For now only the invite code, with Copy and Share (the phone's share sheet: SMS, Signal…).
// Mobile counterpart of the "My profile" tab of src/renderer/src/views/SettingsView.tsx.
import { useEffect, useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router/stack'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { useCore } from '../store'
import { colors, fonts, radius, space } from '../theme'

export const SettingsScreen = () => {
  const { t } = useTranslation()
  const me = useCore((s) => s.state?.me)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  if (!me) return null

  const copy = async () => {
    await Clipboard.setStringAsync(me.inviteCode)
    setCopied(true)
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('settings.title') }} />

      <Text style={styles.label}>//{t('settings.inviteCode')}</Text>
      <Text style={styles.code} selectable>
        {me.inviteCode}
      </Text>
      <Text style={styles.hint}>{t('settings.inviteCodeHint')}</Text>
      <View style={styles.row}>
        <Button label={copied ? t('settings.copied') : t('settings.copy')} onPress={copy} />
        <Button label={t('settings.share')} onPress={() => Share.share({ message: `junglemesh://add/${me.inviteCode}` })} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space * 2, gap: space },
  label: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase'
  },
  code: {
    color: colors.accent,
    fontFamily: fonts.mono,
    backgroundColor: colors.bgDeep,
    padding: space * 1.5,
    borderRadius: radius
  },
  hint: { color: colors.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', gap: space, flexWrap: 'wrap' }
})
