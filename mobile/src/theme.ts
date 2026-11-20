//* Design tokens: the same "sober cyberpunk" palette as the desktop
// (src/renderer/src/styles/abstracts/_variables.scss). React Native has no CSS:
// styles are JS objects (StyleSheet.create), so the SCSS variables become constants here.
import { Platform } from 'react-native'

export const colors = {
  bgDeep: '#07090d', // deepest background (fields)
  bg: '#0c1017', // panels
  bgSoft: '#121823', // raised elements
  border: '#263243',
  line: '#1c2531',
  text: '#d5dde8',
  textMuted: '#7a8799',
  textDim: '#4b5768', // section labels
  accent: '#1fd1c8', // active, online
  onAccent: '#04100f', // text on a turquoise background
  danger: '#ff06b5', // attention: errors, decline
  warn: '#ffb454'
}

export const space = 8
export const radius = 2

export const fonts = {
  mono: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' })
}
