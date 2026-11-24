//* Monochrome icons, same drawings as the desktop (src/renderer/src/components/Icon.tsx)
// 24×24 grid, line drawing (stroke 1.8, rounded ends). React Native has no <svg>:
// react-native-svg provides the same elements, capitalised (Svg, Path…).
// To add an icon: copy its paths from the desktop file, replacing <path> with <Path>.
import type { ReactNode } from 'react'
import Svg, { Path, Rect } from 'react-native-svg'
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
  pencil: <Path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  file: (
    <>
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <Path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  // Paperclip and download arrow: drawn inline by the desktop's Composer and FileCard
  attach: <Path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  download: <Path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  // Audio player of the chat (play: the desktop's drawing; pause: two bars)
  play: <Path d="M7 4.5 19 12 7 19.5z" />,
  pause: <Path d="M8 5v14M16 5v14" />,
  // Calls (the desktop's CallControls)
  mic: (
    <>
      <Rect x="9" y="3" width="6" height="11" rx="3" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </>
  ),
  micOff: (
    <>
      <Path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
      <Path d="M18.5 11a6.5 6.5 0 0 1-.9 3.3M5.5 11a6.5 6.5 0 0 0 10 5.5M12 17.5V21M9 21h6M4 4l16 16" />
    </>
  ),
  headphones: (
    <>
      <Path d="M4 17v-4a8 8 0 0 1 16 0v4" />
      <Rect x="3" y="14" width="4" height="6" rx="1.5" />
      <Rect x="17" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  headphonesOff: (
    <>
      <Path d="M4 17v-4a8 8 0 0 1 12.5-6.6M19.4 9.8c.4.9.6 2 .6 3.2v4" />
      <Rect x="3" y="14" width="4" height="6" rx="1.5" />
      <Rect x="17" y="14" width="4" height="6" rx="1.5" />
      <Path d="M4 4l16 16" />
    </>
  ),
  volume: <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" />,
  // Handset without the waves of the desktop's ringing phone (the waves are animated there)
  phone: (
    <Path d="M21 16.4v2.9a2 2 0 0 1-2.2 2 18.5 18.5 0 0 1-8-2.9 18.2 18.2 0 0 1-5.6-5.6 18.5 18.5 0 0 1-2.9-8.1A2 2 0 0 1 4.3 2.5h2.9a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L8.2 10a14.7 14.7 0 0 0 5.6 5.6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 2z" />
  )
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
