//* A voice call in a channel, window side: the microphone, one WebRTC connection per participant (mesh),
// playback of the voices and detection of "who is speaking".
// WebRTC (RTCPeerConnection) is already in Chromium, hence in Electron: no library to add.
// The main process is only used to exchange the signaling messages (offer, answer, ICE).
import type { AppSettings, VoiceSignal } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { getVoiceVolume } from '../utils/voiceVolume'

// STUN servers: they help two PCs behind routers discover their public address.
// They see NO audio (just "what is my address?"), but they do see our IP. On the same local network, useless.
// Known limit: without a TURN server (relay), two very restrictive networks (symmetric NAT) will not reach each other.
const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]

// WebRTC configuration according to the privacy setting.
// Relay mode: NO STUN, and `iceTransportPolicy: 'relay'` forbids any direct path → friends only see
// the TURN relay's IP (the audio stays end-to-end encrypted by DTLS-SRTP, the relay cannot read it).
const rtcConfig = (prefs: VoicePrefs): RTCConfiguration => {
  const turn: RTCIceServer[] = prefs.turnUrl
    ? [{ urls: prefs.turnUrl, username: prefs.turnUser, credential: prefs.turnPass }]
    : []
  if (prefs.voiceRelayOnly) return { iceServers: turn, iceTransportPolicy: 'relay' }
  return { iceServers: [...STUN_SERVERS, ...turn] }
}

const SPEAKING_LEVEL = 0.02 // amplitude (0 to 1) above which the person is considered to be speaking
const SPEAKING_HOLD_MS = 350 // the indicator stays lit for a moment (avoids flickering between two words)

export type LinkState = 'connecting' | 'connected' | 'failed'

export interface VoiceStatus {
  phase: 'starting' | 'live' | 'error'
  error: string
  muted: boolean
  deafened: boolean
  speaking: string[] // keys of those who are speaking (me included)
  links: Record<string, LinkState> // connection state with each participant
}

type VoicePrefs = Pick<AppSettings, 'voiceRelayOnly' | 'turnUrl' | 'turnUser' | 'turnPass'>
type AudioPrefs = VoicePrefs &
  Pick<AppSettings, 'micId' | 'speakerId' | 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'>

// What we exchange through signaling (data of a VoiceSignal)
type Signal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

interface Link {
  pc: RTCPeerConnection
  initiator: boolean // only one of the two people sends the offer (the one with the larger key): never a collision
  pendingIce: RTCIceCandidateInit[] // candidates received before the offer/answer
  audio: HTMLAudioElement | null
}

// Measures the volume of a stream to light the "speaking" indicator
interface Meter {
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
  lastLoud: number
}

export class VoiceSession {
  private links = new Map<string, Link>()
  private meters = new Map<string, Meter>()
  private ctx = new AudioContext()
  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private status: VoiceStatus = {
    phase: 'starting',
    error: '',
    muted: false,
    deafened: false,
    speaking: [],
    links: {}
  }

  constructor(
    readonly roomKey: string,
    readonly chanId: string,
    private myKey: string,
    private prefs: AudioPrefs,
    private onChange: (status: VoiceStatus) => void
  ) {}

  //& Startup: microphone first, then we announce ourselves (if the microphone is refused, we do not appear in the channel)
  async start(): Promise<void> {
    // Relay mode without a configured relay: we refuse rather than silently leak the IP
    if (this.prefs.voiceRelayOnly && !this.prefs.turnUrl) throw new Error(t('voice.relayMissing'))
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.prefs.micId ? { exact: this.prefs.micId } : undefined,
          echoCancellation: this.prefs.echoCancellation, // cancels the speakers' feedback into the microphone
          noiseSuppression: this.prefs.noiseSuppression, // attenuates fan, keyboard…
          autoGainControl: this.prefs.autoGainControl, // smooths the voice volume
          channelCount: 1
        }
      })
    } catch (err) {
      throw new Error(micError(err))
    }
    void this.ctx.resume()
    this.watch(this.myKey, this.stream)
    this.timer = setInterval(() => this.measure(), 100)
    await window.api.voiceJoin(this.roomKey, this.chanId)
    this.update({ phase: 'live' })
  }

  //& Participants: called on every change of the channel's list (keys, me included)
  sync(keys: string[]): void {
    if (this.stopped || !this.stream) return
    const others = new Set(keys.filter((k) => k !== this.myKey))
    for (const key of others) if (!this.links.has(key)) this.addLink(key)
    for (const key of [...this.links.keys()]) if (!others.has(key)) this.removeLink(key)
  }

  // Signal received from a participant
  async handleSignal(signal: VoiceSignal): Promise<void> {
    if (this.stopped || signal.room !== this.roomKey || signal.chan !== this.chanId) return
    const data = signal.data as Partial<Signal> | null
    if (!data || typeof data.kind !== 'string') return

    // An offer may arrive before the participant list is up to date: we create the link at that point
    let link = this.links.get(signal.from)
    if (!link && data.kind === 'offer') link = this.addLink(signal.from)
    if (!link) return
    const { pc } = link

    try {
      if (data.kind === 'offer' && typeof data.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        await this.flushIce(link)
        await pc.setLocalDescription() // creates the answer by itself
        this.send(signal.from, { kind: 'answer', sdp: pc.localDescription!.sdp })
      } else if (data.kind === 'answer' && typeof data.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flushIce(link)
      } else if (data.kind === 'ice' && data.candidate && typeof data.candidate === 'object') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate)
        else link.pendingIce.push(data.candidate)
      }
    } catch (err) {
      console.warn('voice: signal ignored', err)
    }
  }

  //& Buttons
  setMuted(muted: boolean): void {
    this.update({ muted })
    this.applyMic()
  }

  // Full deafen: no more voices received, and the microphone is muted too (like Discord)
  setDeafened(deafened: boolean): void {
    this.update({ deafened })
    this.applyMic()
    for (const { audio } of this.links.values()) if (audio) audio.muted = deafened
  }

  // Listening volume of one participant (0 → 1), applied live
  setVolume(key: string, volume: number): void {
    const audio = this.links.get(key)?.audio
    if (audio) audio.volume = Math.min(1, Math.max(0, volume))
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    for (const key of [...this.links.keys()]) this.removeLink(key)
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx.close()
  }

  //& Internal
  private addLink(key: string): Link {
    const pc = new RTCPeerConnection(rtcConfig(this.prefs))
    const link: Link = { pc, initiator: this.myKey > key, pendingIce: [], audio: null }
    this.links.set(key, link)
    this.setLink(key, 'connecting')
    for (const track of this.stream!.getAudioTracks()) pc.addTrack(track, this.stream!)

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(key, { kind: 'ice', candidate: e.candidate.toJSON() })
    }
    // Only the initiator proposes: addTrack fires this event on both sides, the other waits for the offer
    pc.onnegotiationneeded = async () => {
      if (!link.initiator) return
      try {
        await pc.setLocalDescription()
        this.send(key, { kind: 'offer', sdp: pc.localDescription!.sdp })
      } catch (err) {
        console.warn('voix : offre impossible', err)
      }
    }
    pc.ontrack = (e) => {
      const remote = e.streams[0] ?? new MediaStream([e.track])
      // Chromium only plays a remote stream if it is attached to an audio element
      const audio = new Audio()
      audio.srcObject = remote
      audio.muted = this.status.deafened
      audio.volume = getVoiceVolume(key) // personal volume chosen with the right-click menu
      if (this.prefs.speakerId) void audio.setSinkId(this.prefs.speakerId).catch(() => {})
      void audio.play().catch(() => {})
      link.audio = audio
      this.watch(key, remote)
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') this.setLink(key, 'connected')
      else if (s === 'failed') {
        this.setLink(key, 'failed')
        if (link.initiator) pc.restartIce() // new network path attempt
      } else if (s === 'connecting' || s === 'new') this.setLink(key, 'connecting')
    }
    return link
  }

  private removeLink(key: string): void {
    const link = this.links.get(key)
    if (!link) return
    link.pc.close()
    if (link.audio) link.audio.srcObject = null
    this.links.delete(key)
    this.meters.delete(key)
    const { [key]: _gone, ...links } = this.status.links
    this.update({ links })
  }

  private async flushIce(link: Link): Promise<void> {
    for (const c of link.pendingIce.splice(0)) await link.pc.addIceCandidate(c).catch(() => {})
  }

  private send(to: string, data: Signal): void {
    void window.api.voiceSignal(to, this.roomKey, this.chanId, data).catch(() => {})
  }

  private applyMic(): void {
    const on = !this.status.muted && !this.status.deafened
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = on))
  }

  private setLink(key: string, state: LinkState): void {
    this.update({ links: { ...this.status.links, [key]: state } })
  }

  //& Voice detection
  private watch(key: string, stream: MediaStream): void {
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 512
    this.ctx.createMediaStreamSource(stream).connect(analyser) // not connected to the output: we only measure
    this.meters.set(key, { analyser, data: new Uint8Array(analyser.fftSize), lastLoud: 0 })
  }

  private measure(): void {
    const now = Date.now()
    const speaking: string[] = []
    for (const [key, meter] of this.meters) {
      // My muted microphone does not "speak", even if the room is noisy
      if (key === this.myKey && (this.status.muted || this.status.deafened)) continue
      meter.analyser.getByteTimeDomainData(meter.data)
      let peak = 0
      for (const v of meter.data) peak = Math.max(peak, Math.abs(v - 128) / 128)
      if (peak > SPEAKING_LEVEL) meter.lastLoud = now
      if (now - meter.lastLoud < SPEAKING_HOLD_MS) speaking.push(key)
    }
    const same = speaking.length === this.status.speaking.length && speaking.every((k) => this.status.speaking.includes(k))
    if (!same) this.update({ speaking })
  }

  private update(patch: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onChange(this.status)
  }
}

// Clear message depending on the cause of the microphone refusal
const micError = (err: unknown): string => {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return t('voice.micDenied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('voice.micNotFound')
  return t('voice.micFailed')
}
