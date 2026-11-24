//* The call in progress (Zustand): only one at a time for the whole app, like the desktop's voice
// The phone has a single window: the call must survive moving between screens (chat → home → room),
// so it lives in a global store and not in a screen's hook (the desktop's useVoice is per window).
import { AppState, PermissionsAndroid } from 'react-native'
import { create } from 'zustand'
import InCallManager from 'react-native-incall-manager'
import type { CoreState, VoiceSignal } from '../../../src/shared/types'
import { t } from '../../../src/shared/i18n'
import { call, on } from '../bridge'
import { useCore } from '../store'
import { VoiceSession, type VoiceStatus } from './VoiceSession'

const DM_CALL = 'dm' // channel id of a call between two friends (same constant as the core)

// Where the call takes place: a friend's 1-to-1 call (room = callId) or a room's voice channel
export interface CallSpot {
  room: string
  chan: string
  friendKey?: string // 1-to-1 call: the friend
  title: string // shown in the call bar ("Alice", "#lounge")
}

interface CallStore {
  spot: CallSpot | null
  status: VoiceStatus | null
  speaker: boolean // loudspeaker (otherwise the earpiece, or the headset when one is plugged)
  error: string // microphone refused, friend declined… shown in the call bar / chat until dismissed
  join: (spot: CallSpot) => Promise<void>
  leave: () => void
  setMuted: (muted: boolean) => void
  setDeafened: (deafened: boolean) => void
  setSpeaker: (speaker: boolean) => void
  clearError: () => void
}

let session: VoiceSession | null = null
let listed = false // I appeared in the participant list at least once (see watchParticipants)
let ringback = false // waiting tone playing (1-to-1 call, the friend has not picked up yet)

const setRingback = (on: boolean) => {
  if (on === ringback) return
  ringback = on
  if (on) InCallManager.startRingback('_DTMF_')
  else InCallManager.stopRingback()
}

// Microphone permission asked BEFORE the call starts: Android's permission dialog sends the app to the
// "background" state for a moment, which would otherwise hang up the call being set up (see wireCalls)
const micAllowed = async (): Promise<boolean> => {
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
  if (await PermissionsAndroid.check(perm)) return true
  return (await PermissionsAndroid.request(perm)) === PermissionsAndroid.RESULTS.GRANTED
}

// Participants of a spot in the core's state (me included)
export const participantsOf = (state: CoreState | null | undefined, spot: Pick<CallSpot, 'room' | 'chan'>): string[] => {
  if (!state) return []
  if (spot.chan === DM_CALL) return state.friends.find((f) => f.callId === spot.room)?.call ?? []
  return state.rooms.find((r) => r.key === spot.room)?.voice[spot.chan] ?? []
}

// Android audio mode of a call: in-call routing (earpiece / headset / loudspeaker), proximity sensor
// (screen off against the ear), audio focus (music paused). See manual.md › "appels audio sur mobile".
const audioMode = (speaker: boolean) => {
  // null = the default route: headset if plugged (wired or Bluetooth), else the earpiece
  InCallManager.setForceSpeakerphoneOn(speaker ? true : (null as unknown as boolean))
}

export const useCall = create<CallStore>((set, get) => {
  const stop = (error = '') => {
    const current = session
    session = null
    listed = false
    if (current) {
      current.stop()
      void call('voiceLeave').catch(() => {})
      setRingback(false)
      InCallManager.stop()
    }
    set({ spot: null, status: null, error })
  }

  return {
    spot: null,
    status: null,
    speaker: false,
    error: '',

    join: async (spot) => {
      const me = useCore.getState().state?.me.publicKey
      if (!me) return
      if (session?.roomKey === spot.room && session.chanId === spot.chan) return
      if (!(await micAllowed().catch(() => false))) return set({ error: t('mobile.micDenied') })
      stop()
      // 1-to-1 call: held to the ear like a phone call; voice channel: loudspeaker, like Discord
      const speaker = !spot.friendKey
      const current = new VoiceSession(spot.room, spot.chan, me, (status) => {
        if (session === current) set({ status })
      })
      session = current
      set({ spot, speaker, error: '', status: null })
      try {
        await current.start()
      } catch (err) {
        if (session === current) stop(err instanceof Error ? err.message : String(err))
        return
      }
      if (session !== current) return // hung up while the microphone was starting
      InCallManager.start({ media: 'audio' })
      audioMode(speaker)
      watchParticipants()
    },

    leave: () => stop(),

    setMuted: (muted) => session?.setMuted(muted),
    setDeafened: (deafened) => session?.setDeafened(deafened),
    setSpeaker: (speaker) => {
      set({ speaker })
      if (session) audioMode(speaker)
    },
    clearError: () => set({ error: '' })
  }
})

//& Following the participants: the core's state says who is in the call → connections opened / closed
const watchParticipants = () => {
  const { spot } = useCall.getState()
  if (!session || !spot) return
  const me = useCore.getState().state?.me.publicKey
  const keys = participantsOf(useCore.getState().state, spot)
  session.sync(keys)
  const inList = !!me && keys.includes(me)
  // Call cut by the core (room left, friend removed…): I WAS in the list, and I am no longer.
  // "Was": the state arrives a moment after voiceJoin (it is batched), so right after joining I am not in it yet.
  if (inList) listed = true
  else if (listed) return useCall.getState().leave()
  // 1-to-1 call, alone: a waiting tone until the friend picks up
  setRingback(!!spot.friendKey && inList && keys.length === 1)
}

// Subscriptions made once for the whole app (see RootLayout)
let wired = false
export const wireCalls = () => {
  if (wired) return
  wired = true
  useCore.subscribe((s, prev) => {
    if (s.state !== prev.state) watchParticipants()
  })
  // WebRTC signals from the other participants → the current call
  on('voice-signal', (signal: VoiceSignal) => void session?.handleSignal(signal))
  // The friend I am calling refused: we hang up and say it
  on('call-declined', (from: string, room: string) => {
    const { spot } = useCall.getState()
    if (spot?.room !== room) return
    const name = useCore.getState().state?.friends.find((f) => f.key === from)?.name ?? from.slice(0, 8)
    useCall.getState().leave()
    useCall.setState({ error: t('call.declined', { name }) })
  })
  // App sent to the background: the worker suspends the network and Android cuts the microphone,
  // so we hang up cleanly (a call in the background needs a foreground service, not done yet)
  AppState.addEventListener('change', (state) => {
    if (state === 'background' && useCall.getState().spot) {
      useCall.getState().leave()
      useCall.setState({ error: t('mobile.callBackground') })
    }
  })
}
