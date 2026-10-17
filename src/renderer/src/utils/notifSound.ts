//* Notification sound and ringtones. Default sounds synthesized with Web Audio (no audio file to ship,
// nor licence to check); the user can replace them with their own file (Settings › Notifications).
import type { AppSettings, SoundKind } from '../../../shared/types'

type SoundSettings = Pick<AppSettings, 'speakerId' | 'notifSoundFile' | 'ringtoneFile'> | null | undefined

let ctx: AudioContext | null = null // reused: creating one per sound is slow and limited in number

// Shared context, sent to the output chosen in Settings › Video & audio (same as the voices)
const audio = async (speakerId = ''): Promise<AudioContext> => {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  const sinked = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  if (speakerId && sinked.setSinkId) await sinked.setSinkId(speakerId).catch(() => {})
  return ctx
}

//& Custom sound: read from the profile and decoded once, as long as its name does not change
const custom: Partial<Record<SoundKind, { name: string; buffer: Promise<AudioBuffer | null> }>> = {}
const customBuffer = (ac: AudioContext, kind: SoundKind, name: string): Promise<AudioBuffer | null> => {
  if (!name) return Promise.resolve(null)
  const cached = custom[kind]
  if (cached?.name === name) return cached.buffer
  const buffer = window.api
    .getSound(kind)
    .then((bytes) => (bytes ? ac.decodeAudioData(bytes.slice().buffer) : null))
    .catch(() => null) // unreadable file: we fall back to the default sound
  custom[kind] = { name, buffer }
  return buffer
}

// New file chosen (possibly with the same name as the previous one): to be decoded again
export const forgetCustomSound = (kind: SoundKind): void => {
  delete custom[kind]
}

// Plays a buffer, cut with a short fade after `max` seconds (a whole song as a notification would be long)
const playBuffer = (ac: AudioContext, out: AudioNode, buffer: AudioBuffer, at: number, max: number): void => {
  const src = ac.createBufferSource()
  const gain = ac.createGain()
  src.buffer = buffer
  const end = Math.min(buffer.duration, max)
  gain.gain.setValueAtTime(1, at + Math.max(0, end - 0.15))
  gain.gain.linearRampToValueAtTime(0, at + end)
  src.connect(gain).connect(out)
  src.start(at)
  src.stop(at + end)
}

// One synthesized note with an envelope: 10 ms attack (no click), then exponential fade
const note = (ac: AudioContext, out: AudioNode, freq: number, at: number, length: number, volume: number): void => {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(gain).connect(out)
  osc.start(at)
  osc.stop(at + length + 0.01)
}

//& Notification: two short notes going up (A5 → E6), ~0.35 s, discreet
const MAX_NOTIF_S = 4

export const playNotifSound = async (settings: SoundSettings): Promise<void> => {
  const ac = await audio(settings?.speakerId)
  const buffer = await customBuffer(ac, 'notif', settings?.notifSoundFile ?? '')
  const start = ac.currentTime + 0.01
  if (buffer) return playBuffer(ac, ac.destination, buffer, start, MAX_NOTIF_S)
  note(ac, ac.destination, 880, start, 0.25, 0.12)
  note(ac, ac.destination, 1318.5, start + 0.09, 0.25, 0.12)
}

//& Ringtones, repeated until stopped
// incoming: little trill (G5 / B5 ×3) every 2.5 s, or the custom file;
// outgoing (I am calling, waiting for an answer): one soft low chord every 3 s
const SYNTH_RINGS = {
  incoming: { period: 2.5, play: (ac: AudioContext, out: AudioNode, at: number) => {
    for (let i = 0; i < 6; i++) note(ac, out, i % 2 ? 987.8 : 784, at + i * 0.11, 0.1, 0.1)
  } },
  outgoing: { period: 3, play: (ac: AudioContext, out: AudioNode, at: number) => {
    note(ac, out, 440, at, 0.9, 0.05)
    note(ac, out, 554.4, at + 0.02, 0.9, 0.03)
  } }
}
// Safety net: a call that nobody answers does not ring forever
const MAX_RING_S = 45

export type RingKind = keyof typeof SYNTH_RINGS

// Returns the function that stops it (also cuts the sounds already scheduled)
export const startRing = (kind: RingKind, settings: SoundSettings): (() => void) => {
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let master: GainNode | null = null
  const stop = (): void => {
    stopped = true
    clearInterval(timer)
    master?.disconnect()
    master = null
  }
  void (async () => {
    const ac = await audio(settings?.speakerId)
    const buffer = kind === 'incoming' ? await customBuffer(ac, 'ring', settings?.ringtoneFile ?? '') : null
    if (stopped) return
    const out = (master = ac.createGain())
    out.connect(ac.destination)
    // Custom file: played in full (up to the limit), then 0.5 s of silence before starting again
    const ring = buffer
      ? { period: Math.max(buffer.duration + 0.5, 2.5), play: (a: AudioContext, o: AudioNode, at: number) => playBuffer(a, o, buffer, at, MAX_RING_S) }
      : SYNTH_RINGS[kind]
    const startedAt = ac.currentTime
    const once = (): void => {
      if (ac.currentTime - startedAt > MAX_RING_S) return stop()
      ring.play(ac, out, ac.currentTime + 0.02)
    }
    once()
    timer = setInterval(once, ring.period * 1000)
  })()
  return stop
}
