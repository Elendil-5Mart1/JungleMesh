//* A call on the phone: the microphone and one WebRTC connection per participant (mesh), audio only
// Mobile counterpart of src/renderer/src/voice/VoiceSession.ts, with the SAME signaling protocol, so a
// phone and a computer can call each other. React Native has no WebRTC: react-native-webrtc brings the
// same API as the browser (RTCPeerConnection, getUserMedia), backed by Google's native library.
// Differences with the desktop:
//   - no camera or screen yet: the video slots the computer creates are answered "inactive" (nothing received);
//   - the remote voices play by themselves (native audio), no <audio> element;
//   - "who speaks" comes from the connection's statistics (audioLevel), there is no Web Audio here.
import { mediaDevices, MediaStream, RTCPeerConnection, type RTCRtpTransceiver } from 'react-native-webrtc'
import { t } from '../../../src/shared/i18n'
import type { VoiceSignal } from '../../../src/shared/types'
import { call } from '../bridge'

// STUN servers, as on the desktop: they tell each side its public address, they never see the audio
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]

const SPEAKING_LEVEL = 0.02 // audioLevel (0 to 1) above which the person is considered to be speaking
const SPEAKING_HOLD_MS = 350 // the indicator stays lit for a moment (avoids flickering between two words)
const MEASURE_MS = 250 // statistics are read 4 times a second (they cross the native bridge)

export type LinkState = 'connecting' | 'connected' | 'failed'

export interface VoiceStatus {
  phase: 'starting' | 'live'
  muted: boolean
  deafened: boolean
  speaking: string[] // keys of those who are speaking (me included)
  links: Record<string, LinkState> // connection state with each participant
}

// What we exchange through signaling (same shapes as the desktop; 'media' and 'watch' are about video)
type Signal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: unknown }
  | { kind: 'media'; cam: boolean; screen?: boolean }
  | { kind: 'watch'; on: boolean }

interface Link {
  pc: RTCPeerConnection
  initiator: boolean // only one of the two people sends the offer (the one with the larger key): never a collision
  pendingIce: unknown[] // candidates received before the offer/answer
  remote: MediaStream | null // their voice
  queue: Promise<void> // signals of this participant, handled one after the other
  lastLoud: number // last moment their voice was above the threshold
}

export class VoiceSession {
  private links = new Map<string, Link>()
  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private myLastLoud = 0
  private measuring = false // a reading of the statistics is still running (they are async)
  private stopped = false
  private status: VoiceStatus = { phase: 'starting', muted: false, deafened: false, speaking: [], links: {} }

  constructor(
    readonly roomKey: string,
    readonly chanId: string,
    private myKey: string,
    private onChange: (status: VoiceStatus) => void
  ) {}

  //& Startup: microphone first, then we announce ourselves (microphone refused = we never appear in the call)
  async start(): Promise<void> {
    try {
      // getUserMedia asks Android for the microphone permission itself. WebRTC's echo cancellation,
      // noise suppression and gain control are on by default.
      this.stream = await mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err) {
      console.warn('voice: microphone refused', err)
      throw new Error(t('mobile.micDenied'))
    }
    if (this.stopped) return this.release()
    this.timer = setInterval(() => void this.measure(), MEASURE_MS)
    await call('voiceJoin', this.roomKey, this.chanId)
    this.update({ phase: 'live' })
  }

  //& Participants: called on every change of the call's list (keys, me included)
  sync(keys: string[]): void {
    if (this.stopped || !this.stream) return
    const others = new Set(keys.filter((k) => k !== this.myKey))
    for (const key of others) if (!this.links.has(key)) this.addLink(key)
    for (const key of [...this.links.keys()]) if (!others.has(key)) this.removeLink(key)
  }

  // Signal received from a participant, chained per participant (see the desktop's handleSignal)
  handleSignal(signal: VoiceSignal): Promise<void> {
    if (this.stopped || signal.room !== this.roomKey || signal.chan !== this.chanId) return Promise.resolve()
    const data = signal.data as Partial<Signal> | null
    if (!data || typeof data.kind !== 'string') return Promise.resolve()
    // An offer may arrive before the participant list is up to date: we create the link at that point
    let link = this.links.get(signal.from)
    if (!link && data.kind === 'offer' && this.stream) link = this.addLink(signal.from)
    if (!link) return Promise.resolve()
    const current = link
    current.queue = current.queue.then(() => this.applySignal(current, signal.from, data))
    return current.queue
  }

  private async applySignal(link: Link, from: string, data: Partial<Signal>): Promise<void> {
    if (this.stopped || this.links.get(from) !== link) return // hung up / participant gone meanwhile
    const { pc } = link
    try {
      if (data.kind === 'offer' && typeof data.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        this.refuseExtraSlots(pc)
        await this.flushIce(link)
        await pc.setLocalDescription() // creates the answer by itself
        this.send(from, { kind: 'answer', sdp: pc.localDescription!.sdp })
      } else if (data.kind === 'answer' && typeof data.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flushIce(link)
      } else if (data.kind === 'ice' && data.candidate && typeof data.candidate === 'object') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate as any)
        else link.pendingIce.push(data.candidate)
      }
      // 'media' (their camera / screen) and 'watch': video, not on the phone yet
    } catch (err) {
      console.warn('voice: signal ignored', err)
    }
  }

  //& Buttons
  setMuted(muted: boolean): void {
    this.update({ muted })
    this.applyMic()
  }

  // Full deafen: no more voices received, and the microphone is muted too (like Discord and the desktop)
  setDeafened(deafened: boolean): void {
    this.update({ deafened })
    this.applyMic()
    for (const link of this.links.values()) this.applyRemote(link)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    for (const key of [...this.links.keys()]) this.removeLink(key)
    this.release()
  }

  //& Internal
  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream?.release()
    this.stream = null
  }

  private addLink(key: string): Link {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const link: Link = { pc, initiator: this.myKey > key, pendingIce: [], remote: null, queue: Promise.resolve(), lastLoud: 0 }
    this.links.set(key, link)
    this.setLink(key, 'connecting')
    // Microphone = first audio slot. As the initiator, the phone creates nothing else: the computer
    // then has no video slot towards us, so its camera is simply not sent to the phone.
    for (const track of this.stream!.getAudioTracks()) pc.addTrack(track, this.stream!)

    pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) this.send(key, { kind: 'ice', candidate: e.candidate.toJSON() })
    })
    // Only the initiator proposes: addTrack fires this event on both sides, the other waits for the offer
    pc.addEventListener('negotiationneeded', async () => {
      if (!link.initiator || this.stopped) return
      try {
        await pc.setLocalDescription()
        this.send(key, { kind: 'offer', sdp: pc.localDescription!.sdp })
      } catch (err) {
        console.warn('voice: offer failed', err)
      }
    })
    pc.addEventListener('track', (e: any) => {
      if (e.track?.kind !== 'audio' || e.transceiver !== this.micSlot(pc)) return // screen sound: not on the phone
      link.remote = e.streams?.[0] ?? new MediaStream([e.track])
      this.applyRemote(link)
    })
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState
      if (s === 'connected') this.setLink(key, 'connected')
      else if (s === 'failed') {
        this.setLink(key, 'failed')
        if (link.initiator) pc.restartIce() // new network path attempt
      } else if (s === 'connecting' || s === 'new') this.setLink(key, 'connecting')
    })
    return link
  }

  private removeLink(key: string): void {
    const link = this.links.get(key)
    if (!link) return
    link.pc.close()
    this.links.delete(key)
    const { [key]: _gone, ...links } = this.status.links
    this.update({ links, speaking: this.status.speaking.filter((k) => k !== key) })
  }

  // The first audio slot carries the voice (the computer may add a second one, for its screen's sound)
  private micSlot(pc: RTCPeerConnection): RTCRtpTransceiver | undefined {
    return pc.getTransceivers().find((tr) => tr.receiver.track?.kind === 'audio')
  }

  // The computer's offer also brings 2 video slots and 1 screen-sound slot: answered "inactive", so it
  // never sends us a camera or a screen the phone cannot show (and that would cost data for nothing)
  private refuseExtraSlots(pc: RTCPeerConnection): void {
    const mic = this.micSlot(pc)
    for (const tr of pc.getTransceivers()) {
      if (tr === mic || tr.stopped) continue
      try {
        tr.direction = 'inactive'
      } catch (err) {
        console.warn('voice: slot not refused', err)
      }
    }
  }

  private async flushIce(link: Link): Promise<void> {
    for (const c of link.pendingIce.splice(0)) await link.pc.addIceCandidate(c as any).catch(() => {})
  }

  private send(to: string, data: Signal): void {
    void call('voiceSignal', to, this.roomKey, this.chanId, data).catch(() => {})
  }

  // A disabled track sends silence (muted) / is not played (deafened)
  private applyMic(): void {
    const on = !this.status.muted && !this.status.deafened
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = on))
  }

  private applyRemote(link: Link): void {
    link.remote?.getAudioTracks().forEach((track) => (track.enabled = !this.status.deafened))
  }

  private setLink(key: string, state: LinkState): void {
    this.update({ links: { ...this.status.links, [key]: state } })
  }

  //& Voice detection, from the statistics: "inbound-rtp" = their voice, "media-source" = my microphone
  private async measure(): Promise<void> {
    if (this.measuring) return
    this.measuring = true
    try {
      await this.readLevels()
    } finally {
      this.measuring = false
    }
  }

  private async readLevels(): Promise<void> {
    const now = Date.now()
    for (const [key, link] of this.links) {
      const report = (await link.pc.getStats().catch(() => null)) as Map<string, any> | null
      if (!report || this.links.get(key) !== link) continue
      for (const s of report.values()) {
        if (s.kind !== 'audio' || typeof s.audioLevel !== 'number' || s.audioLevel <= SPEAKING_LEVEL) continue
        if (s.type === 'inbound-rtp') link.lastLoud = now
        if (s.type === 'media-source') this.myLastLoud = now
      }
    }
    if (this.stopped) return
    const speaking: string[] = []
    const micOn = !this.status.muted && !this.status.deafened // my muted microphone does not "speak"
    if (micOn && now - this.myLastLoud < SPEAKING_HOLD_MS) speaking.push(this.myKey)
    for (const [key, link] of this.links) if (now - link.lastLoud < SPEAKING_HOLD_MS) speaking.push(key)
    const same = speaking.length === this.status.speaking.length && speaking.every((k) => this.status.speaking.includes(k))
    if (!same) this.update({ speaking })
  }

  private update(patch: Partial<VoiceStatus>): void {
    if (this.stopped && patch.phase) return
    this.status = { ...this.status, ...patch }
    this.onChange(this.status)
  }
}
