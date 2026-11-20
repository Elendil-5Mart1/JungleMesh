//* Button (React Native has no <button>: Pressable + Text)
import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, radius, space } from '../theme'

interface ButtonProps {
  label: string
  onPress: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
}

export const Button = ({ label, onPress, kind = 'ghost', disabled }: ButtonProps) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [styles.btn, styles[kind], (pressed || disabled) && styles.pressed]}
  >
    <Text style={[styles.text, kind === 'primary' && styles.textPrimary, kind === 'danger' && styles.textDanger]}>
      {label}
    </Text>
  </Pressable>
)

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1,
    borderRadius: radius,
    paddingHorizontal: space * 2,
    paddingVertical: space,
    alignItems: 'center',
    justifyContent: 'center'
  },
  ghost: { borderColor: colors.border },
  primary: { borderColor: colors.accent, backgroundColor: colors.accent },
  danger: { borderColor: colors.danger },
  pressed: { opacity: 0.5 },
  text: { color: colors.text },
  textPrimary: { color: colors.onAccent, fontWeight: 'bold' },
  textDanger: { color: colors.danger }
})
