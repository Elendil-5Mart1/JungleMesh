//* Settings (gear of the home screen)
// My profile (picture, display name, custom status), the invite code with Copy, Copy my invite link and
// Share (the phone's share sheet: SMS, Signal…), the message lifetime
// and the update check (not in the Play Store build: Play handles updates).
// Mobile counterpart of the "My profile" tab of src/renderer/src/views/SettingsView.tsx.
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { Stack } from 'expo-router/stack'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { MAX_CUSTOM_STATUS } from '../../../src/shared/types'
import { changeMyAvatar } from '../avatar'
import { call } from '../bridge'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { useCore } from '../store'
import { colors, fonts, radius, space } from '../theme'
import { IS_STORE_BUILD } from '../updates'

const NOBODY: never[] = [] // stable empty list

export const SettingsScreen = () => {
  const { t } = useTranslation()
  const me = useCore((s) => s.state?.me)
  const blocked = useCore((s) => s.state?.blocked) ?? NOBODY
  const settings = useCore((s) => s.settings)
  const saveSettings = useCore((s) => s.saveSettings)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [error, setError] = useState('')
  // The field is typed freely, then saved when leaving it ('' or 0 = never)
  const [days, setDays] = useState('')
  useEffect(() => setDays(settings?.messageTtlDays ? String(settings.messageTtlDays) : ''), [settings?.messageTtlDays])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  if (!me) return null

  const commitDays = () => {
    const value = Number.parseInt(days, 10)
    const next = Number.isSafeInteger(value) && value > 0 ? value : 0
    if (next === (settings?.messageTtlDays ?? 0)) return setDays(next ? String(next) : '')
    void saveSettings({ messageTtlDays: next })
  }

  // The code alone, or the link (junglemesh://add/<code>: opens JungleMesh on the friend's side)
  const link = `junglemesh://add/${me.inviteCode}`
  const copy = async (what: 'code' | 'link') => {
    await Clipboard.setStringAsync(what === 'link' ? link : me.inviteCode)
    setCopied(what)
  }

  // Shows the error of a profile change (unreadable picture…)
  const run = (action: () => Promise<unknown>) => {
    setError('')
    action().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const saveName = (value: string) => {
    const name = value.trim()
    if (name && name !== me.name) run(() => call('setName', name))
  }

  const saveStatus = (value: string) => {
    if (value.trim() !== me.customStatus) run(() => call('setCustomStatus', value.trim()))
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('settings.title') }} />

      {/*& My profile (also editable from the home screen: avatar, name and status) */}
      <Text style={styles.label}>//{t('settings.tabs.profile')}</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.profile}>
        <Pressable onPress={() => run(changeMyAvatar)} style={({ pressed }) => pressed && styles.pressed}>
          <Avatar src={me.avatar} name={me.name} size={80} />
        </Pressable>
        <View style={styles.profileSide}>
          <Text style={styles.hint}>{t('settings.photoHintMobile')}</Text>
          {!!me.avatar && <Button label={t('settings.remove')} onPress={() => run(() => call('setAvatar', null))} />}
        </View>
      </View>

      <Text style={styles.fieldLabel}>{t('settings.name')}</Text>
      <TextInput
        key={me.name} // changed from the home screen: the field shows the new name
        style={styles.field}
        defaultValue={me.name}
        maxLength={32}
        returnKeyType="done"
        onEndEditing={(e) => saveName(e.nativeEvent.text)}
      />

      <Text style={styles.fieldLabel}>{t('settings.status')}</Text>
      <TextInput
        key={`status:${me.customStatus}`}
        style={styles.field}
        defaultValue={me.customStatus}
        placeholder={t('settings.statusPlaceholder')}
        placeholderTextColor={colors.textDim}
        maxLength={MAX_CUSTOM_STATUS}
        returnKeyType="done"
        onEndEditing={(e) => saveStatus(e.nativeEvent.text)}
      />
      <Text style={styles.hint}>{t('settings.statusHint')}</Text>

      <Text style={[styles.label, styles.section]}>//{t('settings.inviteCode')}</Text>
      <Text style={styles.code} selectable>
        {me.inviteCode}
      </Text>
      <Text style={styles.hint}>{t('settings.inviteCodeHint')}</Text>
      <View style={styles.row}>
        <Button label={copied === 'code' ? t('settings.copied') : t('settings.copy')} onPress={() => void copy('code')} />
        <Button
          label={copied === 'link' ? t('settings.linkCopied') : t('settings.copyLink')}
          kind="primary"
          onPress={() => void copy('link')}
        />
        <Button label={t('settings.share')} onPress={() => Share.share({ message: link })} />
      </View>
      <Text style={styles.hint}>{t('settings.inviteLinkHint')}</Text>

      <Text style={[styles.label, styles.section]}>//{t('settings.messageTtl')}</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={days}
          onChangeText={(text) => setDays(text.replace(/[^0-9]/g, '').slice(0, 5))}
          onEndEditing={commitDays}
          keyboardType="number-pad"
          placeholder="∞"
          placeholderTextColor={colors.textDim}
          editable={settings !== null}
        />
        <Text style={styles.unit}>{t('settings.messageTtlDays')}</Text>
      </View>
      <Text style={styles.hint}>
        {settings?.messageTtlDays
          ? t('settings.messageTtlHint', { count: settings.messageTtlDays })
          : t('settings.messageTtlNever')}
      </Text>

      {/*& Privacy: stealth mode and the blocked people (desktop: Settings › Privacy) */}
      <Text style={[styles.label, styles.section]}>//{t('settings.tabs.privacy')}</Text>
      <Text style={styles.hint}>{t('mobile.privacyIntro')}</Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('privacy.stealth')}</Text>
        <Switch
          value={settings?.stealth ?? false}
          onValueChange={(stealth) => void saveSettings({ stealth })}
          disabled={settings === null}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>
      <Text style={styles.hint}>{t('privacy.stealthHint')}</Text>

      <Text style={styles.fieldLabel}>{t('privacy.blocked')}</Text>
      {blocked.length === 0 && <Text style={styles.hint}>{t('privacy.noBlocked')}</Text>}
      {blocked.map((b) => (
        <View key={b.key} style={styles.person}>
          <Avatar src={b.avatar} name={b.name} size={32} />
          <Text style={styles.switchLabel} numberOfLines={1}>
            {b.name}
          </Text>
          <Button label={t('privacy.unblock')} onPress={() => run(() => call('unblock', b.key))} />
        </View>
      ))}
      {blocked.length > 0 && <Text style={styles.hint}>{t('privacy.unblockHint')}</Text>}

      {!IS_STORE_BUILD && (
        <>
          <Text style={[styles.label, styles.section]}>//{t('privacy.updates')}</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('privacy.autoUpdate')}</Text>
            <Switch
              value={settings?.checkUpdates ?? false}
              onValueChange={(checkUpdates) => void saveSettings({ checkUpdates })}
              disabled={settings === null}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text}
            />
          </View>
          <Text style={styles.hint}>{t('privacy.autoUpdateHint')}</Text>
        </>
      )}
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
  error: { color: colors.danger },
  pressed: { opacity: 0.6 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space * 2 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space * 1.5 },
  profileSide: { flex: 1, gap: space, alignItems: 'flex-start' },
  fieldLabel: { color: colors.textMuted, fontSize: 12, textTransform: 'uppercase', marginTop: space },
  field: {
    color: colors.text,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  section: { marginTop: space * 3 },
  input: {
    color: colors.accent,
    fontFamily: fonts.mono,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space,
    minWidth: 90,
    textAlign: 'center'
  },
  unit: { color: colors.text, alignSelf: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space },
  switchLabel: { color: colors.text, flex: 1 },
  row: { flexDirection: 'row', gap: space, flexWrap: 'wrap' }
})
