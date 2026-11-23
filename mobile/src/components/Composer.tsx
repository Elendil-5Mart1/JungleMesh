//* Message input shared by the DM and room screens
// Must be placed at the bottom of a keyboard-controller KeyboardAvoidingView (see ChatScreen).
// The paperclip sends a photo or a file right away (the desktop stages them with the text instead).
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Icon } from './Icon'
import { ActionSheet, type SheetSpec } from './Sheet'
import { colors, radius, space } from '../theme'

interface ComposerProps {
  placeholder: string
  onSend: (text: string) => Promise<unknown> // rejected = not sent: the text is given back
  disabled?: boolean // e.g. room not joined yet
  // Paperclip: picks then sends a photo or a file (false = the user backed out). Missing = no paperclip.
  onAttach?: (kind: 'photo' | 'file') => Promise<boolean>
}

export const Composer = ({ placeholder, onSend, disabled, onAttach }: ComposerProps) => {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<SheetSpec | null>(null)
  const [attaching, setAttaching] = useState(false) // copy into the log running (a big file takes a while)
  const insets = useSafeAreaInsets() // the composer stays above Android's navigation bar (edge-to-edge)
  // A docked keyboard covers the navigation bar. Not "isVisible": a floating keyboard is visible
  // but leaves the bottom of the screen free (its height is 0)
  const keyboardDocked = useKeyboardState((k) => k.height > 0)

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setError('')
    setDraft('') // emptied right away: the message comes back through the 'message' event
    try {
      await onSend(text)
    } catch (err) {
      setDraft(text) // not sent: give the text back
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const attach = async (kind: 'photo' | 'file') => {
    if (!onAttach) return
    setError('')
    setAttaching(true)
    try {
      await onAttach(kind)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAttaching(false)
    }
  }

  const openAttach = () =>
    setSheet({
      title: t('composer.attach'),
      actions: [
        { label: t('mobile.attachPhoto'), onPress: () => attach('photo') },
        { label: t('mobile.attachFile'), onPress: () => attach('file') }
      ]
    })

  return (
    <>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {attaching && <Text style={styles.sending}>{t('mobile.sendingFile')}</Text>}
      <View style={[styles.composer, { paddingBottom: space + (keyboardDocked ? 0 : insets.bottom) }]}>
        {onAttach && (
          <Pressable
            onPress={openAttach}
            disabled={disabled || attaching}
            accessibilityLabel={t('composer.attach')}
            hitSlop={6}
            style={({ pressed }) => [styles.attach, (disabled || attaching) && styles.disabled, pressed && styles.pressed]}
          >
            {attaching ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="attach" size={22} color={colors.textMuted} />}
          </Pressable>
        )}
        <TextInput
          style={[styles.input, disabled && styles.disabled]}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          editable={!disabled}
          multiline
          maxLength={4000}
        />
        <Button label={t('composer.send')} kind="primary" onPress={send} disabled={disabled || !draft.trim()} />
      </View>
      <ActionSheet spec={sheet} onClose={() => setSheet(null)} />
    </>
  )
}

const styles = StyleSheet.create({
  error: { color: colors.danger, paddingHorizontal: space * 1.5, paddingBottom: space / 2 },
  sending: { color: colors.textMuted, fontSize: 12, paddingHorizontal: space * 1.5, paddingBottom: space / 2 },
  attach: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space,
    padding: space,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    backgroundColor: colors.bg
  },
  input: {
    flex: 1,
    maxHeight: 140,
    backgroundColor: colors.bgDeep,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  disabled: { opacity: 0.5 }
})
