//* Welcome screen (first launch): choose a display name and, optionally, a picture
// Mobile counterpart of src/renderer/src/components/Welcome.tsx. Shown by the home screen as long as
// no name has been saved (me.named); the name can still be changed later from the home screen.
// "I already have a backup" restores an identity instead (a .jmbackup from another phone or a computer).
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useTranslation } from 'react-i18next'
import type { Me } from '../../../src/shared/types'
import { changeMyAvatar } from '../avatar'
import { call } from '../bridge'
import { Avatar } from '../components/Avatar'
import { BackupPanel } from '../components/BackupPanel'
import { Button } from '../components/Button'
import { colors, radius, space } from '../theme'

export const WelcomeScreen = ({ me }: { me: Me }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)

  // The 'state' event with named = true makes the home screen replace this one
  const start = () => {
    if (name.trim()) void call('setName', name.trim()).catch((err) => setError(String(err?.message ?? err)))
  }

  const pickPicture = () => {
    setError('')
    void changeMyAvatar().catch((err) => setError(String(err?.message ?? err)))
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.body} behavior="padding">
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.intro}>{t('welcome.intro')}</Text>

        <Pressable onPress={pickPicture} accessibilityLabel={t('mobile.pickPicture')} style={({ pressed }) => pressed && styles.pressed}>
          <Avatar src={me.avatar} name={name || me.name} size={96} />
        </Pressable>
        <Text style={styles.hint}>{t('mobile.pickPicture')}</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          onSubmitEditing={start}
          placeholder={t('welcome.namePlaceholder')}
          placeholderTextColor={colors.textDim}
          maxLength={32}
          autoFocus
          returnKeyType="done"
        />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button label={t('welcome.start')} kind="primary" onPress={start} disabled={!name.trim()} />

        <Pressable onPress={() => setRestoring(!restoring)} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.link}>{t('welcome.haveBackup')}</Text>
        </Pressable>
        {restoring && <BackupPanel importOnly />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space * 2, padding: space * 3 },
  title: { color: colors.text, fontSize: 22, fontWeight: '600', textAlign: 'center' },
  intro: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  hint: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  pressed: { opacity: 0.6 },
  input: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgDeep,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    fontSize: 17,
    textAlign: 'center',
    paddingHorizontal: space * 1.5,
    paddingVertical: space * 1.25
  },
  error: { color: colors.danger },
  link: { color: colors.accent, fontSize: 14, textDecorationLine: 'underline', marginTop: space }
})
