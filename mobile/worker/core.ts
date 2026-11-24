//* Bare worker: runs the desktop P2P core (src/main/p2p) inside the phone app
// The React Native UI cannot run Hyperswarm (no UDP sockets, no native addons):
// the core lives in a Bare worklet, a separate JS runtime started by react-native-bare-kit.
// Both sides talk through the IPC stream with one JSON object per line:
//   UI → worker  { id, method, args }        call a core method
//   worker → UI  { id, result } | { id, error }   its answer
//   worker → UI  { event, args }             a core event (state, message…)
// The same file is bundled by scripts/build-worker.mjs, which maps node:* to bare-*.
import b4a from 'b4a'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MAX_BACKUP,
  SCRYPT,
  applyRestore,
  checkPassphrase,
  collectBackup,
  decryptBackup,
  encryptBackup,
  stageRestore,
  wipeData,
  type Scrypt
} from '../../src/main/backup'
import { P2PCore } from '../../src/main/p2p/core'
import { setupI18n, t } from '../../src/shared/i18n'
import { DEFAULT_IMAGE_TTL_HOURS, IMAGE_TTL_CHOICES, type ChatMessage, type CoreState } from '../../src/shared/types'
import { createUnread } from './unread'

//& What the UI may reach
// An explicit list: TypeScript's `private` does not exist at runtime,
// so a generic bridge would otherwise expose the core's internals.
const METHODS = new Set([
  'getState',
  'setName',
  'setAvatar',
  'setCustomStatus',
  'addFriend',
  'acceptRequest',
  'declineRequest',
  'removeFriend',
  'unblock',
  'setStealth',
  'createRoom',
  'renameRoom',
  'setRoomAvatar',
  'createChannel',
  'renameChannel',
  'deleteChannel',
  'kickFromRoom',
  'deleteRoom',
  'leaveRoom',
  'inviteToRoom',
  'acceptRoomInvite',
  'declineRoomInvite',
  'getHistory',
  'send',
  'deleteMessage',
  'editMessage',
  'react',
  'setImageTtl',
  'setRoomImageTtl',
  // Files: paths in the app's cache, prepared by the UI (see mobile/src/files.ts)
  'sendFilePath',
  'saveFile',
  'confirmReceived',
  'releaseFile',
  'imageDataUrl',
  // Calls: the audio goes through WebRTC in the UI (mobile/src/voice), the core only relays presence and signaling
  'voiceJoin',
  'voiceLeave',
  'voiceSignal',
  'declineCall'
])

const EVENTS = [
  'state',
  'message',
  'message-annotated',
  'message-deleted',
  'file-progress',
  'voice-signal',
  'call-declined'
]

//& Settings of this phone (the desktop keeps them in Electron's settings.json, which does not exist here)
// Stored next to the logs, in the app's private folder.
export interface MobileSettings {
  messageTtlDays: number // messages older than this are hidden and their received files erased (0 = never)
  checkUpdates: boolean // look for a newer APK on GitHub (see mobile/src/updates.ts), like the desktop's autoUpdate
  stealth: boolean // stealth mode: only friends and room members can connect (P2PCore.setStealth)
  downloadDir: string // content:// URI of the folder where received files are saved ('' = not chosen yet)
  imageTtlHours: number // shared images erased after this delay in my conversations (0 = never; a room's creator can override it)
}

const DEFAULT_SETTINGS: MobileSettings = {
  messageTtlDays: 0,
  checkUpdates: true,
  stealth: false,
  downloadDir: '',
  imageTtlHours: DEFAULT_IMAGE_TTL_HOURS
}
const SETTINGS_FILE = 'mobile-settings.json'
const PURGE_DELAY_MS = 20_000 // first purge shortly after the start, then every 30 min (as on the desktop)
const PURGE_EVERY_MS = 30 * 60_000

// Only known keys with a valid value: a hand-edited or older file never breaks the start
const cleanSettings = (raw: any): MobileSettings => {
  const days = Number(raw?.messageTtlDays)
  return {
    messageTtlDays: Number.isSafeInteger(days) && days > 0 && days <= 36_500 ? days : 0,
    checkUpdates: typeof raw?.checkUpdates === 'boolean' ? raw.checkUpdates : DEFAULT_SETTINGS.checkUpdates,
    stealth: typeof raw?.stealth === 'boolean' ? raw.stealth : DEFAULT_SETTINGS.stealth,
    downloadDir:
      typeof raw?.downloadDir === 'string' && raw.downloadDir.startsWith('content://') && raw.downloadDir.length < 2000
        ? raw.downloadDir
        : DEFAULT_SETTINGS.downloadDir,
    // One of the offered choices only (the same list as the desktop)
    imageTtlHours: IMAGE_TTL_CHOICES.includes(raw?.imageTtlHours) ? raw.imageTtlHours : DEFAULT_SETTINGS.imageTtlHours
  }
}

// Waiting for the data lock held by the worklet of a reloaded UI: up to 10 s
const LOCK_ATTEMPTS = 40
const LOCK_DELAY_MS = 250

// Identity backup: Bare has no scrypt, @noble/hashes (pure JS, audited) gives the same key as the desktop's
// node:crypto, so a .jmbackup moves between the computer and the phone. asyncTick lets the IPC breathe.
const scrypt: Scrypt = (password, salt) => scryptAsync(password, salt, { ...SCRYPT, asyncTick: 20 })

// The Bare runtime's global (lifecycle events of the worklet)
declare const Bare: { on(event: 'suspend' | 'resume', fn: () => void): void }

interface Request {
  id: number
  method: string
  args?: unknown[]
}

//& Entry point (called by the bare-stow harness with the IPC stream)
export const start = (ipc: any) => {
  let core: P2PCore | null = null
  let buffered = '' // IPC chunks are not aligned on messages: keep the incomplete end

  const send = (msg: unknown) => ipc.write(b4a.from(JSON.stringify(msg) + '\n'))

  // First call from the UI: where to store the data (the app's private folder),
  // only the React Native side knows it.
  let starting: Promise<P2PCore> | null = null
  let settings: MobileSettings = DEFAULT_SETTINGS
  let settingsPath = ''
  let purgeTimer: ReturnType<typeof setInterval> | null = null
  let myKey = '' // known once the core has started (my own messages are not unread)
  let unread: ReturnType<typeof createUnread> | null = null
  let dataFolder = '' // given by the first init, kept for a restart (restore, reset)
  let restarting = false

  const init = async (dataDir: string) => {
    dataFolder = dataDir
    // The UI was reloaded by Fast Refresh: the core keeps running (and a 2nd init during
    // the start waits for the same start instead of opening the data twice)
    starting ??= setupI18n()
      .then(() => loadSettings(dataDir))
      .then(() => loadUnread(dataDir))
      .then(() => openCore(dataDir))
      .then((started) => {
        myKey = started.getState().me.publicKey
        // Pruning the counters of vanished conversations only once the friends and rooms are loaded
        started.on('state', (state: CoreState) => unread?.onState(state))
        startPurge(started)
        return started
      })
      .catch((err) => {
        starting = null // failed: the next init tries again
        throw err
      })
    core = await starting
    return core.getState()
  }

  const loadSettings = async (dataDir: string) => {
    settingsPath = join(dataDir, SETTINGS_FILE)
    try {
      settings = cleanSettings(JSON.parse(await readFile(settingsPath, 'utf-8')))
    } catch {
      settings = DEFAULT_SETTINGS // first start, or unreadable file
    }
  }

  const loadUnread = async (dataDir: string) => {
    unread ??= createUnread(dataDir, () => myKey, (counts) => send({ event: 'unread', args: [counts] }))
    await unread.load()
  }

  // Atomic write (.tmp then rename): the file is never half-written if the app is killed
  const setSettings = async (patch: Partial<MobileSettings>) => {
    if (!settingsPath) throw new Error('core not started')
    settings = cleanSettings({ ...settings, ...patch })
    core?.setMessageTtl(settings.messageTtlDays)
    core?.setStealth(settings.stealth)
    core?.setImageTtl(settings.imageTtlHours)
    await writeFile(`${settingsPath}.tmp`, JSON.stringify(settings, null, 2))
    await rename(`${settingsPath}.tmp`, settingsPath)
    if (core) void core.purgeFiles().catch(() => {}) // a shorter delay frees the files right away
    return settings
  }

  // Images past their lifetime, files of expired messages, my files already delivered: freed regularly
  const startPurge = (started: P2PCore) => {
    const purge = () => void started.purgeFiles().catch(() => {})
    setTimeout(purge, PURGE_DELAY_MS)
    purgeTimer = setInterval(purge, PURGE_EVERY_MS)
  }

  // A FULL reload of the UI (Metro "r", RR, new dependency) creates a new JS engine, so a
  // new worklet, while the old one still holds the lock on the data (corestore/DEVICE).
  // The old worklet is stopped when its engine is destroyed, but slightly AFTER the new one
  // starts: we wait for the lock to be freed instead of failing straight away.
  const openCore = async (dataDir: string): Promise<P2PCore> => {
    for (let attempt = 1; ; attempt++) {
      const candidate = new P2PCore(dataDir)
      candidate.setMessageTtl(settings.messageTtlDays)
      candidate.setImageTtl(settings.imageTtlHours)
      candidate.setStealth(settings.stealth) // before the swarm starts: its firewall reads it
      for (const name of EVENTS) candidate.on(name, (...args: unknown[]) => send({ event: name, args }))
      candidate.on('message', (convId: string, msg: ChatMessage) => unread?.onMessage(convId, msg))
      try {
        await candidate.start()
        return candidate
      } catch (err) {
        await candidate.stop().catch(() => {}) // releases what was opened before the failure
        const locked = err instanceof Error && err.message.includes('could not be locked')
        if (!locked || attempt >= LOCK_ATTEMPTS) throw err
        await new Promise((resolve) => setTimeout(resolve, LOCK_DELAY_MS))
      }
    }
  }

  //& Backup, restore, new identity, erase everything
  // The desktop relaunches the whole app to swap the identity files (the core holds them open).
  // Here the worker is enough: stop the core, change the files while nothing holds them, open it again.
  // The phone's settings (mobile-settings.json) survive everything except "erase everything".
  const restart = async (change: (dir: string) => void): Promise<CoreState> => {
    if (restarting) throw new Error('busy')
    const current = core
    if (!current || !dataFolder) throw new Error('core not started')
    restarting = true
    try {
      if (purgeTimer) clearInterval(purgeTimer)
      purgeTimer = null
      core = null // calls arriving meanwhile get "core not started"
      starting = null
      unread = null // its counters belong to the old identity: a fresh one reads the new unread.json
      await current.stop()
      change(dataFolder)
      return await init(dataFolder)
    } finally {
      restarting = false
    }
  }

  // The encrypted file's text: the UI writes it into the folder the user chose (see mobile/src/backup.ts)
  const exportBackup = (passphrase: unknown): Promise<string> => {
    if (!core) throw new Error('core not started')
    return encryptBackup(collectBackup(dataFolder, core.getPrimaryKey()), checkPassphrase(passphrase), scrypt)
  }

  // Wrong passphrase or bad file: decryptBackup throws before anything changes
  const restoreBackup = async (text: unknown, passphrase: unknown): Promise<CoreState> => {
    if (typeof text !== 'string' || text.length > MAX_BACKUP) throw new Error(t('backup.invalidFile'))
    const data = await decryptBackup(text, checkPassphrase(passphrase), scrypt)
    return restart((dir) => {
      stageRestore(dir, data)
      applyRestore(dir) // the same two steps as the desktop, without the relaunch in between
    })
  }

  const resetData = (mode: unknown): Promise<CoreState> => {
    if (mode !== 'identity' && mode !== 'all') throw new Error(`unknown reset: ${mode}`)
    return restart((dir) => wipeData(dir, mode, [SETTINGS_FILE]))
  }

  //& Audio player of the chat: the sound (checked by the core: real audio bytes) is written where the UI asked
  // (its cache), then the app's copy is freed like after a download, as on the desktop. Returns the real type.
  const audioFile = async (coreKey: unknown, path: unknown): Promise<string> => {
    if (!core) throw new Error('core not started')
    const key = String(coreKey)
    const { mime, bytes } = await core.audioBytes(key)
    await writeFile(String(path), bytes)
    void core.releaseFile(key).catch(() => {})
    return mime
  }

  const handle = async ({ id, method, args = [] }: Request) => {
    try {
      let result: unknown
      if (method === 'init') result = await init(String(args[0]))
      else if (method === 'getSettings') result = settings
      else if (method === 'setSettings') result = await setSettings((args[0] ?? {}) as Partial<MobileSettings>)
      // Unread counters (kept by the worker, see unread.ts): the UI says which conversation is on screen
      else if (method === 'getUnread') result = unread?.get() ?? {}
      else if (method === 'setActive') unread?.setActive(typeof args[0] === 'string' ? args[0] : null)
      else if (method === 'markRead') unread?.markRead(String(args[0]))
      else if (method === 'exportBackup') result = await exportBackup(args[0])
      else if (method === 'restoreBackup') result = await restoreBackup(args[0], args[1])
      else if (method === 'resetData') result = await resetData(args[0])
      else if (method === 'audioFile') result = await audioFile(args[0], args[1])
      else if (!core) throw new Error('core not started')
      else if (!METHODS.has(method)) throw new Error(`unknown method: ${method}`)
      else result = await (core as any)[method](...args)
      send({ id, result: result ?? null })
    } catch (err) {
      send({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  ipc.on('data', (chunk: Uint8Array) => {
    buffered += b4a.toString(chunk)
    let end: number
    while ((end = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, end)
      buffered = buffered.slice(end + 1)
      if (line) handle(JSON.parse(line))
    }
  })

  // App in the background: react-native-bare-kit suspends the worklet by itself (AppState), and Bare
  // tells us first. The swarm is suspended then resumed, otherwise its sockets and DHT routes, frozen
  // for minutes or hours, are dead on return (new network, NAT mapping expired) and friends look offline.
  // `starting` and not `core`: a suspend during the start waits for it. The steps are queued:
  // a quick back-and-forth never resumes while the suspend is still running.
  let lifecycle: Promise<unknown> = Promise.resolve()
  const queue = (step: (c: P2PCore) => Promise<void>) => {
    const current = starting
    if (!current) return // not started yet: nothing to suspend
    lifecycle = lifecycle.then(() => current.then(step)).catch(() => {})
  }
  // A call cannot go on in the background (the swarm is suspended, Android cuts the microphone): we leave
  // it first, while the connections are still up, so the others see us go instead of a frozen participant
  Bare.on('suspend', () =>
    queue(async (c) => {
      c.voiceLeave()
      await c.suspend()
    })
  )
  Bare.on('resume', () => queue((c) => c.resume()))

  // Run by the harness before the worklet exits: close the swarm and the logs cleanly
  return () => {
    if (purgeTimer) clearInterval(purgeTimer)
    return core?.stop()
  }
}
