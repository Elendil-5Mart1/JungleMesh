//* "This conversation is on screen": its messages are read as they arrive (no unread counter)
// The desktop uses the focus of the conversation's window; on the phone it is the screen being
// focused in the navigation stack AND the app being in the foreground.
import { useCallback } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { call } from './bridge'

let current: string | null = null // conversation told to the worker (one at a time)

const tell = (key: string | null) => {
  current = key
  void call('setActive', key).catch(() => {}) // core not started yet: nothing to mark
}

export const useOnScreen = (key: string) =>
  useFocusEffect(
    useCallback(() => {
      if (AppState.currentState === 'active') tell(key)
      // App sent to the background with this screen open: messages received meanwhile are unread
      const sub = AppState.addEventListener('change', (status) => tell(status === 'active' ? key : null))
      return () => {
        sub.remove()
        // Another screen may already have taken over (focus of the next one before the blur of this one)
        if (current === key) tell(null)
      }
    }, [key])
  )
