//* Root layout (Expo Router): starts translations and the P2P core, and declares the screen stack
// Every file of src/app is a screen: index.tsx = home, chat/[key].tsx = a conversation.
import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Stack } from 'expo-router/stack'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { i18nReady } from '../i18n'
import { useCore } from '../store'
import { colors } from '../theme'

export const RootLayout = () => {
  const boot = useCore((s) => s.boot)

  useEffect(() => {
    void i18nReady.then(boot)
  }, [boot])

  // KeyboardProvider: follows the real keyboard height on Android, which edge-to-edge no longer
  // reports by resizing the window (see ChatScreen)
  return (
    <KeyboardProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg }
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </KeyboardProvider>
  )
}

// Expo Router reads the default export of each route file
export default RootLayout
