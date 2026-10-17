//* A call in a channel, window side: the microphone, the camera, one WebRTC connection per participant (mesh),
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

//& Video
// Video "slots" of every connection, created ONCE when the connection opens (before any camera is on).
// Turning the camera on/off then only swaps the track (`replaceTrack`): no new offer/answer, so no
// negotiation collision possible, whoever turns their camera on. The order is the same on both sides:
// the initiator creates the slots, the other receives them in the same order in the offer.
const VIDEO_SLOTS = ['cam', 'screen'] as const
export type VideoSlot = (typeof VIDEO_SLOTS)[number]

// Camera: 720p30 at most, ~1.2 Mb/s per viewer (mesh: I send one copy to each participant)
const CAM_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 }
}
const CAM_MAX_BITRATE = 1_200_000

// Screen sharing: quality chosen in the picker. Mesh = one copy encoded and sent PER VIEWER:
// 1080p60 at 8 Mb/s is fine for 1-2 viewers, not for 5 (upload of the sharer).
// 60 fps = "motion" (games, videos: fluidity first); 30 fps = "detail" (text stays sharp, fps drop if needed).
export const SCREEN_PROFILES = {
  '720p30': { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  '720p60': { width: 1280, height: 720, fps: 60, bitrate: 5_000_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 }
} as const
export type ScreenProfile = keyof typeof SCREEN_PROFILES

// Audio slots: the microphone, and the sound of the shared screen (separate: own volume, not "speaking")
const AUDIO_SLOTS = ['mic', 'screen'] as const
type AudioSlot = (typeof AUDIO_SLOTS)[number]

// Codec order: H.264 first because GPUs encode it in hardware (NVENC, QuickSync, AMF) → almost no CPU,
// important when sharing a game. VP9 / VP8 stay as fallback (software encoding).
const CODEC_RANK = ['video/H264', 'video/VP9', 'video/VP8']
// Inside H.264, for the screen: High profile first (64…, better quality at the same bitrate), then Main, Baseline
const H264_PROFILE_RANK = ['64', '4d', '42e0', '42']

export type LinkState = 'connecting' | 'connected' | 'failed'

export interface VoiceStatus {
  phase: 'starting' | 'live' | 'error'
  error: string
  muted: boolean
  deafened: boolean
  camera: boolean // my camera is on
  localVideo: MediaStream | null // my camera, for my own tile (preview)
  videos: Record<string, MediaStream> // cameras received: participant key → video
  screen: boolean // I am sharing my screen
  localScreen: MediaStream | null // my shared screen (preview)
  viewers: number // how many participants watch my screen
  sharing: string[] // keys of the participants who share their screen
  screens: Record<string, MediaStream> // screens I watch: participant key → video
  speaking: string[] // keys of those who are speaking (me included)
  links: Record<string, LinkState> // connection state with each participant
}

// Diagnostic of one video direction (what I send to / receive from a participant)
export interface VideoStat {
  codec: string // e.g. "H264"
  impl: string // encoder / decoder used by Chromium, e.g. "MediaFoundationVideoEncodeAccelerator", "OpenH264", "libvpx"
  hardware: boolean | null // GPU encoding / decoding (null = Chromium does not say)
  width: number
  height: number
  fps: number
  kbps: number
}

export interface LinkStats {
  sent: VideoStat | null // my camera, to them
  received: VideoStat | null // their camera
  screenSent: VideoStat | null // my screen, to them
  screenReceived: VideoStat | null // their screen
}

type VoicePrefs = Pick<AppSettings, 'voiceRelayOnly' | 'turnUrl' | 'turnUser' | 'turnPass'>
type AudioPrefs = VoicePrefs &
  Pick<AppSettings, 'micId' | 'speakerId' | 'camId' | 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'>

// What we exchange through signaling (data of a VoiceSignal)
type Signal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'media'; cam: boolean; screen?: boolean } // "my camera / my screen is on / off" (the slots exist anyway)
  | { kind: 'watch'; on: boolean } // "I watch your screen / I stop": the screen is only sent to those who watch it

interface Link {
  pc: RTCPeerConnection
  initiator: boolean // only one of the two people sends the offer (the one with the larger key): never a collision
  pendingIce: RTCIceCandidateInit[] // candidates received before the offer/answer
  audio: HTMLAudioElement | null
  screenAudio: HTMLAudioElement | null // sound of their shared screen
  remoteCam: boolean // the participant announced their camera is on
  camView: MediaStream | null // their camera, wrapped once for the <video> element
  remoteScreen: boolean // the participant announced they share their screen
  screenView: MediaStream | null
  watching: boolean // I watch their screen
  watchesMe: boolean // they watch mine → I send it to them
  queue: Promise<void> // signals of this participant, handled one after the other (see handleSignal)
}

// Measures the volume of a stream to light the "speaking" indicator
interface Meter {
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
  lastLoud: number
}

export class VoiceSession {
  // (not private: inspected in dev through window.voiceSession)
  readonly links = new Map<string, Link>()
  private meters = new Map<string, Meter>()
  private ctx = new AudioContext()
  private stream: MediaStream | null = null
  private cam: MediaStreamTrack | null = null
  private screen: { video: MediaStreamTrack; audio: MediaStreamTrack | null; profile: ScreenProfile } | null = null
  private bytes = new Map<string, { bytes: number; at: number }>() // previous stats, to compute the bitrate
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private status: VoiceStatus = {
    phase: 'starting',
    error: '',
    muted: false,
    deafened: false,
    camera: false,
    localVideo: null,
    videos: {},
    screen: false,
    localScreen: null,
    viewers: 0,
    sharing: [],
    screens: {},
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
      this.stream = await openDevice(this.prefs.micId, (deviceId) => ({
        audio: {
          deviceId,
          echoCancellation: this.prefs.echoCancellation, // cancels the speakers' feedback into the microphone
          noiseSuppression: this.prefs.noiseSuppression, // attenuates fan, keyboard…
          autoGainControl: this.prefs.autoGainControl, // smooths the voice volume
          channelCount: 1
        }
      }))
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

  // Signal received from a participant. They are chained per participant: the handling is async (an offer
  // awaits setRemoteDescription…), and a second offer (ICE restart) or a "media" arriving meanwhile must not
  // overtake the first one.
  handleSignal(signal: VoiceSignal): Promise<void> {
    if (this.stopped || signal.room !== this.roomKey || signal.chan !== this.chanId) return Promise.resolve()
    const data = signal.data as Partial<Signal> | null
    if (!data || typeof data.kind !== 'string') return Promise.resolve()

    // An offer may arrive before the participant list is up to date: we create the link at that point
    let link = this.links.get(signal.from)
    if (!link && data.kind === 'offer') link = this.addLink(signal.from)
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
        this.prepareVideo(link) // the video slots now exist on my side too: I can fill them
        this.refreshVideos() // a "camera on" may have arrived before the offer
        await this.flushIce(link)
        await pc.setLocalDescription() // creates the answer by itself
        this.send(from, { kind: 'answer', sdp: pc.localDescription!.sdp })
        void this.tuneVideo(link)
      } else if (data.kind === 'answer' && typeof data.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flushIce(link)
        void this.tuneVideo(link)
      } else if (data.kind === 'ice' && data.candidate && typeof data.candidate === 'object') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate)
        else link.pendingIce.push(data.candidate)
      } else if (data.kind === 'media') {
        link.remoteCam = data.cam === true
        const sharing = data.screen === true
        const started = sharing && !link.remoteScreen
        link.remoteScreen = sharing
        if (!sharing) link.watching = false
        // A share starts: alone with the sharer (private call, 2 in a channel) we watch it right away, like
        // Discord; with more people, it is a click on "Watch" (each viewer costs the sharer some upload)
        if (started && this.links.size === 1) this.watchScreen(from, true)
        this.refreshVideos()
      } else if (data.kind === 'watch') {
        link.watchesMe = data.on === true
        this.feedScreen(link)
        this.countViewers()
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
    for (const { audio, screenAudio } of this.links.values()) {
      if (audio) audio.muted = deafened
      if (screenAudio) screenAudio.muted = deafened
    }
  }

  // Listening volume of one participant (0 → 1), applied live
  setVolume(key: string, volume: number): void {
    const audio = this.links.get(key)?.audio
    if (audio) audio.volume = Math.min(1, Math.max(0, volume))
  }

  // Camera on / off. Off = the track is STOPPED (the camera light turns off), not just hidden.
  async setCamera(on: boolean): Promise<void> {
    if (this.stopped || on === this.status.camera) return
    if (on) {
      let stream: MediaStream
      try {
        stream = await openDevice(this.prefs.camId, (deviceId) => ({ video: { ...CAM_CONSTRAINTS, deviceId } }))
      } catch (err) {
        throw new Error(camError(err))
      }
      // Call ended while the camera was starting: we release it right away
      if (this.stopped) return stream.getTracks().forEach((track) => track.stop())
      this.cam = stream.getVideoTracks()[0]
      this.cam.onended = () => void this.setCamera(false) // camera unplugged / taken by Windows
      this.update({ camera: true, localVideo: stream })
    } else {
      this.cam?.stop()
      this.cam = null
      this.update({ camera: false, localVideo: null })
    }
    for (const [key, link] of this.links) {
      void this.slot(link, 'cam')?.sender.replaceTrack(this.cam).catch(() => {})
      this.send(key, this.mediaSignal())
    }
  }

  // Screen sharing. `sourceId` comes from our picker (screen:sources); the main process hands this exact
  // source to getDisplayMedia. Calling it again while sharing = switching source / quality.
  async startScreen(sourceId: string, profile: ScreenProfile, withAudio: boolean): Promise<void> {
    if (this.stopped) return
    const p = SCREEN_PROFILES[profile]
    await window.api.screenChoose(sourceId, withAudio)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // max only: a smaller screen / window is sent at its own size (never upscaled), aspect ratio kept
        video: { width: { max: p.width }, height: { max: p.height }, frameRate: { ideal: p.fps, max: p.fps } },
        // PC sound as is (music, game: no voice processing), WITHOUT the sound played by this app = the
        // call's voices, otherwise the viewers would hear themselves with a delay
        audio: withAudio
          ? ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true } as MediaTrackConstraints)
          : false
      })
    } catch (err) {
      console.warn('voice: screen capture refused', err)
      throw new Error(t('voice.screenFailed'))
    }
    if (this.stopped) return stream.getTracks().forEach((track) => track.stop())
    this.stopScreen(false) // previous source (switch): the viewers keep watching
    const video = stream.getVideoTracks()[0]
    // Tells the encoder what matters: fluidity (game) or sharpness (text); it lowers the other one first
    video.contentHint = p.fps >= 60 ? 'motion' : 'detail'
    video.onended = () => this.stopScreen() // shared window closed, screen unplugged
    this.screen = { video, audio: stream.getAudioTracks()[0] ?? null, profile }
    this.update({ screen: true, localScreen: new MediaStream([video]) })
    for (const [key, link] of this.links) {
      this.feedScreen(link)
      this.send(key, this.mediaSignal())
    }
  }

  // `announce` false: only used when switching source (the share goes on with the new one)
  stopScreen(announce = true): void {
    if (!this.screen) return
    this.screen.video.onended = null
    this.screen.video.stop()
    this.screen.audio?.stop()
    this.screen = null
    if (!announce) return
    for (const [key, link] of this.links) {
      link.watchesMe = false
      this.feedScreen(link)
      this.send(key, this.mediaSignal())
    }
    this.update({ screen: false, localScreen: null, viewers: 0 })
  }

  // Watch / stop watching a participant's screen: they only send it to those who watch it
  watchScreen(key: string, on: boolean): void {
    const link = this.links.get(key)
    if (!link || (on && !link.remoteScreen)) return
    link.watching = on
    this.send(key, { kind: 'watch', on })
    this.refreshVideos()
  }

  // Video diagnostic, per participant: codec, encoder (hardware or not), resolution, fps, bitrate.
  // To be called every 1-2 s: the bitrate is computed from the previous call.
  async videoStats(): Promise<Record<string, LinkStats>> {
    const out: Record<string, LinkStats> = {}
    for (const [key, link] of this.links) {
      const report = await link.pc.getStats().catch(() => null)
      if (!report) continue
      const stats: LinkStats = { sent: null, received: null, screenSent: null, screenReceived: null }
      const screenMid = this.slot(link, 'screen')?.mid
      for (const s of report.values()) {
        if (s.kind !== 'video' || (s.type !== 'outbound-rtp' && s.type !== 'inbound-rtp')) continue
        const sent = s.type === 'outbound-rtp'
        const bytes: number = sent ? s.bytesSent : s.bytesReceived
        if (!bytes || !s.frameWidth) continue // empty slot (camera off, nothing shared)
        const prev = this.bytes.get(s.id)
        this.bytes.set(s.id, { bytes, at: s.timestamp })
        const kbps = prev && s.timestamp > prev.at ? ((bytes - prev.bytes) * 8) / (s.timestamp - prev.at) : 0
        const stat: VideoStat = {
          codec: String(report.get(s.codecId)?.mimeType ?? '?').replace('video/', ''),
          impl: (sent ? s.encoderImplementation : s.decoderImplementation) ?? '?',
          hardware: (sent ? s.powerEfficientEncoder : s.powerEfficientDecoder) ?? null,
          width: s.frameWidth,
          height: s.frameHeight,
          fps: Math.round(s.framesPerSecond ?? 0),
          kbps: Math.round(kbps)
        }
        // Which slot: the "mid" identifies the transceiver in the stats
        const screen = !!screenMid && s.mid === screenMid
        if (sent) stats[screen ? 'screenSent' : 'sent'] = stat
        else stats[screen ? 'screenReceived' : 'received'] = stat
      }
      out[key] = stats
    }
    return out
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    for (const key of [...this.links.keys()]) this.removeLink(key)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.cam?.stop()
    this.screen?.video.stop()
    this.screen?.audio?.stop()
    void this.ctx.close()
  }

  //& Internal
  private addLink(key: string): Link {
    const pc = new RTCPeerConnection(rtcConfig(this.prefs))
    const link: Link = {
      pc,
      initiator: this.myKey > key,
      pendingIce: [],
      audio: null,
      screenAudio: null,
      remoteCam: false,
      camView: null,
      remoteScreen: false,
      screenView: null,
      watching: false,
      watchesMe: false,
      queue: Promise.resolve()
    }
    this.links.set(key, link)
    this.setLink(key, 'connecting')
    // Microphone = first audio slot (on the other side, the offer's first audio slot is matched with it)
    for (const track of this.stream!.getAudioTracks()) pc.addTrack(track, this.stream!)
    // The initiator creates the video slots and the screen sound slot; the other one receives them with the offer
    if (link.initiator) {
      for (const _slot of VIDEO_SLOTS) pc.addTransceiver('video', { direction: 'sendrecv' })
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      this.prepareVideo(link)
    }

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
        console.warn('voice: offer failed', err)
      }
    }
    pc.ontrack = (e) => {
      // Video tracks are read from their slot (see refreshVideos): here, only the sound
      if (e.track.kind !== 'audio') return
      // Sound of their shared screen: played apart, not used for the "speaking" indicator
      if (e.transceiver === this.audioSlot(link, 'screen')) {
        link.screenAudio = this.play(new MediaStream([e.track]), 1)
        return
      }
      const remote = e.streams[0] ?? new MediaStream([e.track])
      link.audio = this.play(remote, getVoiceVolume(key)) // personal volume chosen with the right-click menu
      this.watch(key, remote)
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') {
        this.setLink(key, 'connected')
        this.send(key, this.mediaSignal()) // they now have a link for sure: we tell them
      } else if (s === 'failed') {
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
    if (link.screenAudio) link.screenAudio.srcObject = null
    this.links.delete(key)
    this.meters.delete(key)
    const { [key]: _gone, ...links } = this.status.links
    this.update({ links })
    this.refreshVideos()
    this.countViewers()
  }

  // Chromium only plays a remote stream if it is attached to an audio element
  private play(stream: MediaStream, volume: number): HTMLAudioElement {
    const audio = new Audio()
    audio.srcObject = stream
    audio.muted = this.status.deafened
    audio.volume = volume
    if (this.prefs.speakerId) void audio.setSinkId(this.prefs.speakerId).catch(() => {})
    void audio.play().catch(() => {})
    return audio
  }

  private mediaSignal(): Signal {
    return { kind: 'media', cam: this.status.camera, screen: !!this.screen }
  }

  // My screen (image + sound) goes only to those who watch it; the others get an empty slot (no upload)
  private feedScreen(link: Link): void {
    const send = !!this.screen && link.watchesMe
    void this.slot(link, 'screen')?.sender.replaceTrack(send ? this.screen!.video : null).catch(() => {})
    void this.audioSlot(link, 'screen')?.sender.replaceTrack(send ? (this.screen!.audio ?? null) : null).catch(() => {})
    if (send) void this.tuneScreen(link)
  }

  private countViewers(): void {
    const viewers = this.screen ? [...this.links.values()].filter((l) => l.watchesMe).length : 0
    if (viewers !== this.status.viewers) this.update({ viewers })
  }

  // Video slot of a connection (undefined as long as the offer has not created it, on the non-initiator side)
  private slot(link: Link, slot: VideoSlot): RTCRtpTransceiver | undefined {
    return link.pc.getTransceivers().filter((tr) => tr.receiver.track.kind === 'video')[VIDEO_SLOTS.indexOf(slot)]
  }

  // Same for the audio slots (microphone, screen sound)
  private audioSlot(link: Link, slot: AudioSlot): RTCRtpTransceiver | undefined {
    return link.pc.getTransceivers().filter((tr) => tr.receiver.track.kind === 'audio')[AUDIO_SLOTS.indexOf(slot)]
  }

  // Slots ready to send: direction, preferred codec, current camera / screen
  private prepareVideo(link: Link): void {
    for (const slot of VIDEO_SLOTS) {
      const tr = this.slot(link, slot)
      if (!tr) continue
      tr.direction = 'sendrecv'
      preferCodecs(tr, slot === 'screen')
    }
    const screenSound = this.audioSlot(link, 'screen')
    if (screenSound) screenSound.direction = 'sendrecv'
    void this.slot(link, 'cam')?.sender.replaceTrack(this.cam).catch(() => {})
    this.feedScreen(link)
  }

  // Bitrate cap per video slot: only possible once negotiated (the encodings exist from then on)
  private async tuneVideo(link: Link): Promise<void> {
    await capSender(this.slot(link, 'cam')?.sender, CAM_MAX_BITRATE)
    await this.tuneScreen(link)
  }

  private async tuneScreen(link: Link): Promise<void> {
    if (!this.screen) return
    const p = SCREEN_PROFILES[this.screen.profile]
    await capSender(this.slot(link, 'screen')?.sender, p.bitrate, p.fps)
  }

  // Cameras to display: those announced as "on" by their owner; screens: those I watch
  private refreshVideos(): void {
    const videos: Record<string, MediaStream> = {}
    const screens: Record<string, MediaStream> = {}
    const sharing: string[] = []
    for (const [key, link] of this.links) {
      const cam = link.remoteCam ? this.slot(link, 'cam') : undefined
      if (cam) videos[key] = link.camView ??= new MediaStream([cam.receiver.track])
      if (!link.remoteScreen) continue
      sharing.push(key)
      const screen = link.watching ? this.slot(link, 'screen') : undefined
      if (screen) screens[key] = link.screenView ??= new MediaStream([screen.receiver.track])
    }
    this.update({ videos, screens, sharing })
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

// Bitrate (and frame rate) cap of a sender, applied to its encoding.
// One at a time per sender: Chromium refuses a setParameters started while the previous one is still running
// (end of negotiation + a viewer arriving at the same moment), and the cap would then be lost.
const capQueue = new WeakMap<RTCRtpSender, Promise<void>>()
const capSender = (sender: RTCRtpSender | undefined, maxBitrate: number, maxFramerate?: number): Promise<void> => {
  if (!sender) return Promise.resolve()
  const run = async (): Promise<void> => {
    const params = sender.getParameters()
    if (!params.encodings?.length) return
    params.encodings[0].maxBitrate = maxBitrate
    if (maxFramerate) params.encodings[0].maxFramerate = maxFramerate
    await sender.setParameters(params).catch((err) => console.warn('voice: video tuning ignored', err))
  }
  const next = (capQueue.get(sender) ?? Promise.resolve()).then(run)
  capQueue.set(sender, next)
  return next
}

// Rank of an H.264 variant by profile (profile-level-id in its parameters); 0 = best
const h264Rank = (c: RTCRtpCodec): number => {
  const id = /profile-level-id=([0-9a-f]+)/i.exec(c.sdpFmtpLine ?? '')?.[1]?.toLowerCase() ?? ''
  const i = H264_PROFILE_RANK.findIndex((prefix) => id.startsWith(prefix))
  return i === -1 ? H264_PROFILE_RANK.length : i
}

// Puts the preferred codecs first (stable sort: the order inside a codec family is kept).
// H.264 is only favored if this machine can both encode AND decode it. `highFirst`: High profile first (screen).
const preferCodecs = (tr: RTCRtpTransceiver, highFirst = false): void => {
  const recv = RTCRtpReceiver.getCapabilities('video')?.codecs
  const send = RTCRtpSender.getCapabilities('video')?.codecs
  if (!recv || !send || typeof tr.setCodecPreferences !== 'function') return
  const canSend = new Set(send.map((c) => c.mimeType))
  const rank = (c: RTCRtpCodec): number => {
    const i = CODEC_RANK.indexOf(c.mimeType)
    return i === -1 || !canSend.has(c.mimeType) ? CODEC_RANK.length : i
  }
  const byProfile = (a: RTCRtpCodec, b: RTCRtpCodec): number =>
    highFirst && a.mimeType === 'video/H264' && b.mimeType === 'video/H264' ? h264Rank(a) - h264Rank(b) : 0
  try {
    tr.setCodecPreferences([...recv].sort((a, b) => rank(a) - rank(b) || byProfile(a, b)))
  } catch (err) {
    console.warn('voice: codec preference ignored', err)
  }
}

// Opens the chosen microphone / camera; if it cannot be found, falls back to the system default device.
// Cases: device unplugged, or id unknown here (Chromium gives different ids depending on the page's origin:
// one chosen in the installed app does not exist in dev mode, they share the same settings.json).
const openDevice = async (
  id: string,
  constraints: (deviceId: ConstrainDOMString | undefined) => MediaStreamConstraints
): Promise<MediaStream> => {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(id ? { exact: id } : undefined))
  } catch (err) {
    const missing = err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')
    if (!id || !missing) throw err
    console.warn('voice: chosen device not found, using the default one')
    return navigator.mediaDevices.getUserMedia(constraints(undefined))
  }
}

// Clear message depending on the cause of the microphone refusal
const micError = (err: unknown): string => {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return t('voice.micDenied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('voice.micNotFound')
  return t('voice.micFailed')
}

// Same for the camera; NotReadableError = already used by another app (Teams, OBS…)
const camError = (err: unknown): string => {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return t('voice.camDenied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('voice.camNotFound')
  if (name === 'NotReadableError') return t('voice.camBusy')
  return t('voice.camFailed')
}

// Can the sound of the PC be shared with the screen (Windows only: 'loopback' capture of the main process)
export const SCREEN_AUDIO = navigator.userAgent.includes('Windows')
