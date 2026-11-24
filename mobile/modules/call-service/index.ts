//* Calls' foreground service (local Expo module, Android only): see android/.../CallService.kt
// Without it, Android cuts the microphone and the app sleeps as soon as JungleMesh leaves the screen.
import { Platform } from 'react-native'
import { requireOptionalNativeModule, type EventSubscription } from 'expo'

interface CallServiceModule {
  start(title: string, text: string, hangup: string, channel: string): boolean
  stop(): void
  isRunning(): boolean
  moveToBack(): void
  addListener(event: 'onHangup', listener: () => void): EventSubscription
}

// Optional: an app built without the module (or iOS) just keeps the old behaviour (call ends in the background)
const native = Platform.OS === 'android' ? requireOptionalNativeModule<CallServiceModule>('CallService') : null

export const callService = {
  available: !!native,
  start: (title: string, text: string, hangup: string, channel: string): boolean => {
    try {
      return native?.start(title, text, hangup, channel) ?? false
    } catch {
      return false
    }
  },
  stop: (): void => native?.stop(),
  isRunning: (): boolean => native?.isRunning() ?? false,
  moveToBack: (): void => native?.moveToBack(),
  onHangup: (listener: () => void): (() => void) => {
    const sub = native?.addListener('onHangup', listener)
    return () => sub?.remove()
  }
}
