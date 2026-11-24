//* One choice among a few (React Native has no <select>): a row of chips, the chosen one highlighted
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, space } from '../theme'

interface ChoiceProps<T> {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

export const Choice = <T,>({ options, value, onChange, disabled }: ChoiceProps<T>) => (
  <View style={styles.row} accessibilityRole="radiogroup">
    {options.map((option) => {
      const chosen = option.value === value
      return (
        <Pressable
          key={option.label}
          onPress={() => !chosen && onChange(option.value)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: chosen, disabled }}
          style={({ pressed }) => [styles.chip, chosen && styles.chosen, (pressed || disabled) && styles.pressed]}
        >
          <Text style={[styles.text, chosen && styles.textChosen]}>{option.label}</Text>
        </Pressable>
      )
    })}
  </View>
)

//& Styles
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space * 0.75
  },
  chosen: { borderColor: colors.accent, backgroundColor: colors.accent },
  pressed: { opacity: 0.6 },
  text: { color: colors.text, fontSize: 13 },
  textChosen: { color: colors.onAccent, fontWeight: '600' }
})
