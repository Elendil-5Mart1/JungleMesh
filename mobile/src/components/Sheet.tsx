//* Menus of the phone: the mobile counterpart of the desktop's right-click menu (ContextMenu.tsx)
// - ActionSheet: list of actions sliding up from the bottom, opened by a long press. A dangerous action
//   asks for confirmation in a system dialog (the desktop asks for a second click instead).
// - Prompt: one-field dialog (rename a room or a channel, edit a message, create a channel).
// Android's Alert only takes 3 buttons: too few for a menu, hence these components.
import { useEffect, useState, type ReactNode } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { colors, radius, space } from '../theme'

export interface SheetAction {
  label: string
  onPress: () => unknown
  danger?: boolean
  confirm?: string // question of the confirmation dialog (dangerous actions)
}

export interface SheetSpec {
  title?: string
  top?: ReactNode // e.g. the quick reactions row, above the actions
  actions: SheetAction[]
}

//& Action sheet (spec = null: closed)
export const ActionSheet = ({ spec, onClose }: { spec: SheetSpec | null; onClose: () => void }) => {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  const choose = (action: SheetAction) => {
    onClose()
    if (!action.confirm) return void action.onPress()
    Alert.alert(action.confirm, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: action.label, style: 'destructive', onPress: () => void action.onPress() }
    ])
  }

  return (
    <Modal visible={!!spec} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Dark backdrop: a tap outside closes the menu */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: space * 2 + insets.bottom }]}>
        {!!spec?.title && (
          <Text style={styles.title} numberOfLines={1}>
            {spec.title}
          </Text>
        )}
        {spec?.top}
        {spec?.actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => choose(action)}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={[styles.actionText, action.danger && styles.danger]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  )
}

//& One-field dialog (spec = null: closed)
export interface PromptSpec {
  title: string
  value?: string // starting text
  placeholder?: string
  submitLabel: string
  multiline?: boolean // message edit
  maxLength?: number
  onSubmit: (value: string) => Promise<unknown> // rejected: the error is shown and the dialog stays open
}

export const Prompt = ({ spec, onClose }: { spec: PromptSpec | null; onClose: () => void }) => {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  // A new dialog starts from its own text
  useEffect(() => {
    setValue(spec?.value ?? '')
    setError('')
  }, [spec])

  const submit = async () => {
    if (!spec || !value.trim()) return
    try {
      await spec.onSubmit(value.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal visible={!!spec} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.dialog}>
          <Text style={styles.title}>{spec?.title}</Text>
          <TextInput
            style={[styles.input, spec?.multiline && styles.inputMultiline]}
            value={value}
            onChangeText={setValue}
            placeholder={spec?.placeholder}
            placeholderTextColor={colors.textDim}
            multiline={spec?.multiline}
            maxLength={spec?.maxLength}
            autoFocus
            selectTextOnFocus={!spec?.multiline}
            onSubmitEditing={spec?.multiline ? undefined : submit}
          />
          {!!error && <Text style={styles.danger}>{error}</Text>}
          <View style={styles.buttons}>
            <Button label={t('common.cancel')} onPress={onClose} />
            <Button label={spec?.submitLabel ?? ''} kind="primary" onPress={submit} disabled={!value.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

//& Styles
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  sheet: {
    backgroundColor: colors.bgDeep,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderTopLeftRadius: radius * 2,
    borderTopRightRadius: radius * 2,
    paddingTop: space * 1.5,
    paddingHorizontal: space
  },
  title: { color: colors.textMuted, fontSize: 13, paddingHorizontal: space, paddingBottom: space },
  action: { paddingHorizontal: space, paddingVertical: space * 1.75, borderRadius: radius },
  actionPressed: { backgroundColor: colors.bgSoft },
  actionText: { color: colors.text, fontSize: 16 },
  danger: { color: colors.danger },

  center: { flex: 1, justifyContent: 'center', padding: space * 2, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  dialog: {
    gap: space * 1.5,
    padding: space * 2,
    backgroundColor: colors.bgDeep,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius * 2
  },
  input: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  inputMultiline: { minHeight: 90, maxHeight: 220, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space }
})
