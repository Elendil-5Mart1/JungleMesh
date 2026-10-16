//* React entry point: every window loads the same app, the route (#…) picks the view
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import { i18n, setupI18n } from '../../shared/i18n'
import { HomeView } from '@/views/HomeView'
import { ChatView } from '@/views/ChatView'
import { RoomView } from '@/views/RoomView'
import { SettingsView } from '@/views/SettingsView'
import { WindowFrame } from '@/components/WindowFrame'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@/styles/main.scss'

// Translations: we plug react-i18next into the shared instance before the first render
i18n.use(initReactI18next)
void setupI18n()

// No need for react-router: a window's route never changes after opening
const route = window.location.hash.slice(1) // "/home", "/settings", "/chat/<key>" or "/room/<key>"
const [, kind, key] = route.match(/^\/(chat|room)\/([0-9a-f]{64})$/) ?? []

const View = () => {
  if (kind === 'chat') return <ChatView friendKey={key} />
  if (kind === 'room') return <RoomView roomKey={key} />
  if (route === '/settings') return <SettingsView />
  return <HomeView />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WindowFrame kind={kind}>
      <View />
    </WindowFrame>
  </StrictMode>
)
