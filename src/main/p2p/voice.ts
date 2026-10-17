//* Voice channels, main-process side: who is in which channel, and WebRTC signaling relay.
// The audio itself does NOT go through here: the windows talk to each other over WebRTC (RTCPeerConnection).
// The P2P core only serves as a "switchboard" between room members:
// it announces presences and forwards the offers/answers (SDP) and ICE candidates.
import { t } from '../../shared/i18n'

//& Types
// Messages exchanged on the Protomux control channel (same channel as the invitations)
export type VoiceControl =
  | { type: 'voice-state'; room: string; chan: string | null } // "I am in this voice channel" (null = I left)
  | { type: 'voice-signal'; room: string; chan: string; data: unknown } // offer / answer / ICE candidate
  | { type: 'voice-decline'; room: string } // "I refuse your call" (1-to-1 call: the caller hangs up)

export interface VoiceSignal {
  from: string
  room: string
  chan: string
  data: unknown
}

export interface VoiceHost {
  // Keys of the room's signed-up members (me included), empty if the room is unknown
  members: (room: string) => string[]
  me: () => string
  send: (key: string, msg: VoiceControl) => boolean
  changed: () => void
  signal: (signal: VoiceSignal) => void // to forward to the window that is calling
  declined: (from: string, room: string) => void // the friend I am calling refused
}

interface Spot {
  room: string
  chan: string
}

const HEX_KEY = /^[0-9a-f]{64}$/
export const MAX_VOICE = 8 // mesh: everyone sends their audio to everyone, beyond that it gets heavy
const MAX_SIGNAL_SIZE = 20_000 // an SDP is ~2-5 KB: we refuse oversized sends

const sameSpot = (a: Spot | null | undefined, room: string, chan: string): boolean =>
  !!a && a.room === room && a.chan === chan

export class VoiceManager {
  private host: VoiceHost
  private local: Spot | null = null // the voice channel where I am (only one at a time, like Discord)
  private remote = new Map<string, Spot>() // member → the channel they are in

  constructor(host: VoiceHost) {
    this.host = host
  }

  //& State for the UI: channel → keys of the participants (me included)
  participants(room: string): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    if (this.local?.room === room) (out[this.local.chan] ??= []).push(this.host.me())
    for (const [key, spot] of this.remote) if (spot.room === room) (out[spot.chan] ??= []).push(key)
    return out
  }

  current(): Spot | null {
    return this.local
  }

  //& Local actions
  join(room: string, chan: string): void {
    if (!this.host.members(room).includes(this.host.me())) throw new Error(t('err.notMember'))
    if (sameSpot(this.local, room, chan)) return
    const present = this.participants(room)[chan] ?? []
    if (present.length >= MAX_VOICE) throw new Error(t('err.voiceFull', { max: MAX_VOICE }))
    this.leave() // we leave the previous channel, if any
    this.local = { room, chan }
    this.announce(room, chan)
    this.host.changed()
  }

  leave(): void {
    if (!this.local) return
    const { room } = this.local
    this.local = null
    this.announce(room, null)
    this.host.changed()
  }

  // Forwards a signaling message to a participant of the same channel
  signal(to: string, room: string, chan: string, data: unknown): void {
    if (!sameSpot(this.local, room, chan) || !sameSpot(this.remote.get(to), room, chan)) return
    this.host.send(to, { type: 'voice-signal', room, chan, data })
  }

  // Refuses a call: we tell the people waiting in it (we are not in it ourselves)
  decline(room: string): void {
    if (!this.host.members(room).includes(this.host.me())) return
    for (const [key, spot] of this.remote) if (spot.room === room) this.host.send(key, { type: 'voice-decline', room })
  }

  //& Reception
  onControl(from: string, raw: unknown): void {
    const msg = raw as Partial<{ type: string; room: string; chan: string | null; data: unknown }>
    if (typeof msg?.room !== 'string' || !HEX_KEY.test(msg.room)) return
    // Only room members count: a stranger can neither appear nor write to us
    const members = this.host.members(msg.room)
    if (!members.includes(from) || !members.includes(this.host.me())) return

    if (msg.type === 'voice-state') {
      if (msg.chan !== null && (typeof msg.chan !== 'string' || msg.chan.length > 64)) return
      if (msg.chan === null) this.remote.delete(from)
      else this.remote.set(from, { room: msg.room, chan: msg.chan })
      this.host.changed()
    }

    if (msg.type === 'voice-signal') {
      if (typeof msg.chan !== 'string') return
      // We only accept a signal from a participant of the channel we are in too
      if (!sameSpot(this.local, msg.room, msg.chan) || !sameSpot(this.remote.get(from), msg.room, msg.chan)) return
      if (JSON.stringify(msg.data ?? null).length > MAX_SIGNAL_SIZE) return
      this.host.signal({ from, room: msg.room, chan: msg.chan, data: msg.data })
    }

    // Only counts if I am really in that call (waiting for them)
    if (msg.type === 'voice-decline' && this.local?.room === msg.room) this.host.declined(from, msg.room)
  }

  // A peer just connected: we tell them where we are
  onPeerReady(key: string): void {
    if (this.local && this.host.members(this.local.room).includes(key)) {
      this.host.send(key, { type: 'voice-state', room: this.local.room, chan: this.local.chan })
    }
  }

  // A peer disconnected: they are no longer in any channel
  onPeerGone(key: string): void {
    if (this.remote.delete(key)) this.host.changed()
  }

  // A room disappeared (left, removed): we forget its presences
  onRoomGone(room: string): void {
    if (this.local?.room === room) this.local = null
    for (const [key, spot] of this.remote) if (spot.room === room) this.remote.delete(key)
  }

  //& Internal
  private announce(room: string, chan: string | null): void {
    for (const key of this.host.members(room)) {
      if (key !== this.host.me()) this.host.send(key, { type: 'voice-state', room, chan })
    }
  }
}
