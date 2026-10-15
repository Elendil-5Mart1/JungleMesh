//* React hook: links a room to its voice call (only one channel at a time in a window)
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { cleanError } from '@/utils/errors'
import { VoiceSession, type VoiceStatus } from './VoiceSession'

export const useVoice = (roomKey: string, myKey: string | undefined, voice: Record<string, string[]> | undefined) => {
  const sessionRef = useRef<VoiceSession | null>(null)
  const [activeChan, setActiveChan] = useState<string | null>(null)
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [error, setError] = useState('')

  const stop = useCallback((): void => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    session.stop()
    setActiveChan(null)
    setStatus(null)
    void window.api.voiceLeave().catch(() => {})
  }, [])

  const join = useCallback(
    async (chanId: string): Promise<void> => {
      if (!myKey) return
      if (sessionRef.current?.chanId === chanId) return
      stop()
      setError('')
      // Audio settings are read when joining (microphone, output, noise reduction)
      const settings = useCoreStore.getState().settings
      if (!settings) return
      const session = new VoiceSession(roomKey, chanId, myKey, settings, (s) => {
        if (sessionRef.current === session) setStatus(s)
      })
      sessionRef.current = session
      setActiveChan(chanId)
      try {
        await session.start()
      } catch (err) {
        if (sessionRef.current === session) {
          sessionRef.current = null
          session.stop()
          setActiveChan(null)
          setStatus(null)
        }
        setError(cleanError(err))
      }
    },
    [roomKey, myKey, stop]
  )

  // WebRTC signals received from the core → to the current call
  useEffect(() => {
    return window.api.onVoiceSignal((signal) => void sessionRef.current?.handleSignal(signal))
  }, [])

  // The channel's participant list changes → we open / close the connections
  const participants = activeChan ? voice?.[activeChan] : undefined
  const participantsKey = participants?.join(',') ?? ''
  useEffect(() => {
    if (!sessionRef.current || !participants) return
    sessionRef.current.sync(participants)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantsKey])

  // Call cut by the core (another voice window, room left…): no more me in the list
  useEffect(() => {
    if (status?.phase === 'live' && myKey && participants && !participants.includes(myKey)) stop()
  }, [status?.phase, participantsKey, myKey, participants, stop])

  // Window closing: we hang up
  useEffect(() => stop, [stop])

  return { activeChan, status, error, join, leave: stop, session: sessionRef }
}
