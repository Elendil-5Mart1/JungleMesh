//* App settings, specific to this device (settings.json in the profile folder)
import { app, safeStorage } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, SoundKind, WindowMaterial } from '../shared/types'

// The three native WebRTC microphone settings (toggles)
const AUDIO_FLAGS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const

const DEFAULTS: AppSettings = {
  notifications: true,
  flash: true,
  notifSound: true,
  ringtone: true,
  notifSoundFile: '',
  ringtoneFile: '',
  windowOpacity: 85, // translucent frosted glass out of the box
  windowMaterial: 'acrylic',
  launchAtStartup: false,
  canAutostart: false, // recomputed on every read, never saved
  muted: [],
  micId: '',
  speakerId: '',
  camId: '',
  mirrorCamera: true,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  stealth: false,
  voiceRelayOnly: false,
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  hideNotificationContent: false,
  contentProtection: false,
  autoUpdate: true,
  autoEmbeds: false,
  imageTtlHours: 72
}

// A relay is only written turn:… or turns:… (nothing else is accepted, even in a hand-edited file)
const TURN_URL = /^turns?:[A-Za-z0-9.\-_]+(:\d{1,5})?(\?transport=(udp|tcp))?$/
const cleanTurn = (v: unknown): string => (typeof v === 'string' && TURN_URL.test(v.trim()) ? v.trim() : '')
const isHours = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24 * 365
const cleanText = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '')
// Window look: never below 30 % (the text would become unreadable on a busy wallpaper)
const isOpacity = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 30 && (v as number) <= 100
const isMaterial = (v: unknown): v is WindowMaterial => v === 'none' || v === 'pearl' || v === 'acrylic'

export const createSettings = (onChange: (settings: AppSettings) => void) => {
  const file = join(app.getPath('userData'), 'settings.json')
  // Launching at startup only makes sense for the installed app (in dev it would be the bare electron.exe)
  const canAutostart = app.isPackaged

  const current: AppSettings = { ...DEFAULTS, canAutostart }
  // The relay password is encrypted with the Windows vault (DPAPI): it does not sit in plain text in settings.json.
  // safeStorage is only usable once the app is ready: we keep the encrypted version and read it on demand.
  let encryptedPass: string | null = null
  const unlock = (): void => {
    if (encryptedPass === null || !app.isReady()) return
    try {
      current.turnPass = safeStorage.decryptString(Buffer.from(encryptedPass, 'base64'))
    } catch {
      current.turnPass = '' // unreadable vault (another Windows session): to be re-entered
    }
    encryptedPass = null
  }
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppSettings>
    // We only take values of the right type: a hand-edited file must not break the app
    if (typeof saved.notifications === 'boolean') current.notifications = saved.notifications
    if (typeof saved.flash === 'boolean') current.flash = saved.flash
    if (typeof saved.notifSound === 'boolean') current.notifSound = saved.notifSound
    if (typeof saved.ringtone === 'boolean') current.ringtone = saved.ringtone
    current.notifSoundFile = cleanText(saved.notifSoundFile)
    current.ringtoneFile = cleanText(saved.ringtoneFile)
    if (isOpacity(saved.windowOpacity)) current.windowOpacity = saved.windowOpacity
    if (isMaterial(saved.windowMaterial)) current.windowMaterial = saved.windowMaterial
    if (typeof saved.launchAtStartup === 'boolean') current.launchAtStartup = saved.launchAtStartup
    if (Array.isArray(saved.muted)) current.muted = saved.muted.filter((k) => typeof k === 'string').slice(0, 500)
    if (typeof saved.micId === 'string') current.micId = saved.micId.slice(0, 200)
    if (typeof saved.speakerId === 'string') current.speakerId = saved.speakerId.slice(0, 200)
    if (typeof saved.camId === 'string') current.camId = saved.camId.slice(0, 200)
    if (typeof saved.mirrorCamera === 'boolean') current.mirrorCamera = saved.mirrorCamera
    for (const k of AUDIO_FLAGS) if (typeof saved[k] === 'boolean') current[k] = saved[k]
    if (typeof saved.stealth === 'boolean') current.stealth = saved.stealth
    if (typeof saved.voiceRelayOnly === 'boolean') current.voiceRelayOnly = saved.voiceRelayOnly
    current.turnUrl = cleanTurn(saved.turnUrl)
    current.turnUser = cleanText(saved.turnUser)
    current.turnPass = cleanText(saved.turnPass) // old plain-text format
    if (typeof (saved as { turnPassEnc?: unknown }).turnPassEnc === 'string') encryptedPass = (saved as { turnPassEnc: string }).turnPassEnc
    if (typeof saved.hideNotificationContent === 'boolean') current.hideNotificationContent = saved.hideNotificationContent
    if (typeof saved.contentProtection === 'boolean') current.contentProtection = saved.contentProtection
    if (typeof saved.autoUpdate === 'boolean') current.autoUpdate = saved.autoUpdate
    if (typeof saved.autoEmbeds === 'boolean') current.autoEmbeds = saved.autoEmbeds
    if (isHours(saved.imageTtlHours)) current.imageTtlHours = saved.imageTtlHours
  } catch {
    // no file yet: default values
  }

  const save = (): void => {
    try {
      unlock()
      const { canAutostart: _info, turnPass, ...toSave } = current
      const secret = turnPass && app.isReady() && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(turnPass).toString('base64') : null
      const out = secret ? { ...toSave, turnPassEnc: secret } : { ...toSave, turnPass }
      writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 2))
      renameSync(`${file}.tmp`, file) // atomic: never half-written
    } catch (err) {
      console.error('settings: write failed', err)
    }
  }

  const applyAutostart = (): void => {
    if (canAutostart) app.setLoginItemSettings({ openAtLogin: current.launchAtStartup })
  }

  return {
    get: (): AppSettings => {
      unlock()
      return { ...current, muted: [...current.muted] }
    },
    isMuted: (convId: string): boolean => current.muted.includes(convId),

    // Custom sound chosen ('' = back to the default sound)
    setSoundFile(kind: SoundKind, name: string): void {
      current[kind === 'notif' ? 'notifSoundFile' : 'ringtoneFile'] = cleanText(name)
      save()
      onChange({ ...current, muted: [...current.muted] })
    },

    update(patch: Partial<AppSettings>): void {
      if (typeof patch.notifications === 'boolean') current.notifications = patch.notifications
      if (typeof patch.flash === 'boolean') current.flash = patch.flash
      if (typeof patch.notifSound === 'boolean') current.notifSound = patch.notifSound
      if (typeof patch.ringtone === 'boolean') current.ringtone = patch.ringtone
      if (isOpacity(patch.windowOpacity)) current.windowOpacity = patch.windowOpacity
      if (isMaterial(patch.windowMaterial)) current.windowMaterial = patch.windowMaterial
      // The sound file names are only changed by the main process (sound:pick / sound:reset), never by a window
      if (typeof patch.launchAtStartup === 'boolean') current.launchAtStartup = patch.launchAtStartup && canAutostart
      if (Array.isArray(patch.muted)) current.muted = patch.muted.filter((k) => typeof k === 'string').slice(0, 500)
      if (typeof patch.micId === 'string') current.micId = patch.micId.slice(0, 200)
      if (typeof patch.speakerId === 'string') current.speakerId = patch.speakerId.slice(0, 200)
      if (typeof patch.camId === 'string') current.camId = patch.camId.slice(0, 200)
      if (typeof patch.mirrorCamera === 'boolean') current.mirrorCamera = patch.mirrorCamera
      for (const k of AUDIO_FLAGS) if (typeof patch[k] === 'boolean') current[k] = patch[k]
      if (typeof patch.stealth === 'boolean') current.stealth = patch.stealth
      if (typeof patch.voiceRelayOnly === 'boolean') current.voiceRelayOnly = patch.voiceRelayOnly
      if (patch.turnUrl !== undefined) current.turnUrl = cleanTurn(patch.turnUrl)
      if (patch.turnUser !== undefined) current.turnUser = cleanText(patch.turnUser)
      if (patch.turnPass !== undefined) {
        encryptedPass = null
        current.turnPass = cleanText(patch.turnPass)
      }
      if (typeof patch.hideNotificationContent === 'boolean') current.hideNotificationContent = patch.hideNotificationContent
      if (typeof patch.contentProtection === 'boolean') current.contentProtection = patch.contentProtection
      if (typeof patch.autoUpdate === 'boolean') current.autoUpdate = patch.autoUpdate
      if (typeof patch.autoEmbeds === 'boolean') current.autoEmbeds = patch.autoEmbeds
      if (isHours(patch.imageTtlHours)) current.imageTtlHours = patch.imageTtlHours
      unlock()
      save()
      applyAutostart()
      onChange({ ...current, muted: [...current.muted] })
    }
  }
}
