//* Identity backup: save an encrypted file / restore from one (mobile counterpart of the desktop's BackupPanel)
// The passphrase only goes to the worker, which encrypts and decrypts (shared code: src/main/backup.ts).
// `importOnly` = welcome screen: nothing to save yet, and nothing to lose, so no confirmation.
import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { call } from '../bridge'
import { folderLabel, pickFile, saveTextFile } from '../files'
import { useCore } from '../store'
import { colors, radius, space } from '../theme'
import { Button } from './Button'

const MIN_PASSPHRASE = 8 // same rule as the worker (backup.ts), checked here to grey out the buttons
const MAX_BACKUP = 20_000_000 // same limit as backup.ts: a bigger file is not a backup

export const BackupPanel = ({ importOnly = false }: { importOnly?: boolean }) => {
  const { t } = useTranslation()
  const restoreBackup = useCore((s) => s.restoreBackup)
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Runs an action and shows its message or its error (scrypt + the core's restart take a few seconds)
  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setMessage(await action())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  //& Save: the worker encrypts, the file goes into the download folder (chosen once, see files.ts)
  const save = () =>
    run(async () => {
      const text = await call<string>('exportBackup', pass)
      const name = `junglemesh-${new Date().toISOString().slice(0, 10)}.jmbackup`
      if (!(await saveTextFile(name, text, 'application/octet-stream'))) return ''
      const folder = useCore.getState().settings?.downloadDir ?? ''
      return t('mobile.backupSaved', { folder: folderLabel(folder) })
    })

  //& Restore: pick the file, then (from the settings) confirm, then the worker swaps the identity
  const restore = (text: string) =>
    run(async () => {
      await restoreBackup(text, pass) // wrong passphrase: throws, nothing changed
      // Welcome screen: the restored name makes the home screen replace it by itself.
      // Settings: back to the home screen, which now shows the restored friends and rooms.
      if (!importOnly) {
        router.dismissTo('/')
        Alert.alert(t('mobile.restored'))
      }
      return ''
    })

  const pick = async () => {
    setError('')
    setMessage('')
    let text: string
    try {
      const file = await pickFile()
      if (!file) return
      if ((file.size ?? 0) > MAX_BACKUP) throw new Error(t('backup.invalidFile'))
      text = await file.text()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    if (importOnly) return restore(text)
    Alert.alert(t('backup.importAsk'), t('mobile.importDetail'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('backup.importConfirm'), style: 'destructive', onPress: () => void restore(text) }
    ])
  }

  const ready = !busy && pass.length >= MIN_PASSPHRASE

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <TextInput
          style={styles.field}
          value={pass}
          onChangeText={setPass}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          placeholder={t('privacy.backupPass')}
          placeholderTextColor={colors.textDim}
        />
        <Button label={show ? t('mobile.hidePass') : t('mobile.showPass')} onPress={() => setShow(!show)} />
      </View>
      <View style={styles.row}>
        {!importOnly && <Button label={t('privacy.backupExport')} kind="primary" onPress={() => void save()} disabled={!ready} />}
        <Button label={t('privacy.backupImport')} onPress={() => void pick()} disabled={!ready} />
      </View>
      {busy && <Text style={styles.hint}>{t('mobile.backupWorking')}</Text>}
      {!!message && <Text style={styles.hint}>{message}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

//& Styles
const styles = StyleSheet.create({
  panel: { alignSelf: 'stretch', gap: space },
  row: { flexDirection: 'row', gap: space, flexWrap: 'wrap' },
  field: {
    flex: 1,
    minWidth: 160,
    color: colors.text,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  hint: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger }
})
