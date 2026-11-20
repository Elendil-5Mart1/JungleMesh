//* Monochrome icons, same drawings as the desktop (src/renderer/src/components/Icon.tsx)
// 24×24 grid, line drawing (stroke 1.8, rounded ends). React Native has no <svg>:
// react-native-svg provides the same elements, capitalised (Svg, Path…).
// To add an icon: copy its paths from the desktop file, replacing <path> with <Path>.
import type { ReactNode } from 'react'
import Svg, { Path } from 'react-native-svg'
import { colors } from '../theme'

const ICONS = {
  settings: (
    <Path
      fill="currentColor"
      stroke="none"
      d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.61.22L2.71 8.84a.49.49 0 0 0 .12.64l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"
    />
  ),
  close: <Path d="M6 6l12 12M18 6 6 18" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  pencil: <Path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  size?: number
  color?: string // = CSS "currentColor" of the desktop
}

export const Icon = ({ name, size = 20, color = colors.text }: IconProps) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    color={color}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {ICONS[name]}
  </Svg>
)
