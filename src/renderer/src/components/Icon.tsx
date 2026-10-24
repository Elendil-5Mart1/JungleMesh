//* Monochrome icons (24×24 grid, line drawing, color = currentColor) replacing the emojis of the buttons.
// Same style as the composer buttons: stroke 1.8, rounded ends. They take the color of the text,
// so hover / active / danger states are done in CSS, like for any text.
import type { ReactNode } from 'react'

const ICONS = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M18.5 11a6.5 6.5 0 0 1-.9 3.3M5.5 11a6.5 6.5 0 0 0 10 5.5M12 17.5V21M9 21h6M4 4l16 16" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 17v-4a8 8 0 0 1 16 0v4" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  headphonesOff: (
    <>
      <path d="M4 17v-4a8 8 0 0 1 12.5-6.6M19.4 9.8c.4.9.6 2 .6 3.2v4" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
      <path d="M4 4l16 16" />
    </>
  ),
  camera: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="M15.5 10.5 21.5 7v10l-6-3.5z" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  stats: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  volume: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" />,
  userPlus: (
    <>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
    </>
  ),
  // Filled gear (Material "settings", the home window's historical drawing)
  settings: (
    <path
      fill="currentColor"
      stroke="none"
      d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.61.22L2.71 8.84a.49.49 0 0 0 .12.64l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"
    />
  ),
  // Ringing phone: the waves have their own class, to animate them separately (.icon__waves)
  phone: (
    <>
      <path d="M21 16.4v2.9a2 2 0 0 1-2.2 2 18.5 18.5 0 0 1-8-2.9 18.2 18.2 0 0 1-5.6-5.6 18.5 18.5 0 0 1-2.9-8.1A2 2 0 0 1 4.3 2.5h2.9a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L8.2 10a14.7 14.7 0 0 0 5.6 5.6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 2z" />
      <path className="icon__waves" d="M14.5 2.5a7 7 0 0 1 7 7M14.5 6a3.5 3.5 0 0 1 3.5 3.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  exitFullscreen: <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
  play: <path d="M7 4.5 19 12 7 19.5z" />,
  crown: <path d="M4 18h16M4.5 15 3 7l5 4 4-6 4 6 5-4-1.5 8z" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14.2c1 1.6 2.3 2.4 4 2.4s3-.8 4-2.4M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="m3.5 18 5.5-5.5 4 4 2.5-2.5 5 5" />
    </>
  )
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export const Icon = ({ name, size = 20, className }: IconProps) => (
  <svg
    className={`icon ${className ?? ''}`}
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {ICONS[name]}
  </svg>
)
