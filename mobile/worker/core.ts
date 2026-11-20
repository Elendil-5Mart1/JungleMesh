//* Bare worker: runs the desktop P2P core (src/main/p2p) inside the phone app
// The React Native UI cannot run Hyperswarm (no UDP sockets, no native addons):
// the core lives in a Bare worklet, a separate JS runtime started by react-native-bare-kit.
// Both sides talk through the IPC stream with one JSON object per line:
//   UI → worker  { id, method, args }        call a core method
//   worker → UI  { id, result } | { id, error }   its answer
//   worker → UI  { event, args }             a core event (state, message…)
// The same file is bundled by scripts/build-worker.mjs, which maps node:* to bare-*.
import b4a from 'b4a'
import { P2PCore } from '../../src/main/p2p/core'
import { setupI18n } from '../../src/shared/i18n'

//& What the UI may reach
// An explicit list: TypeScript's `private` does not exist at runtime,
// so a generic bridge would otherwise expose the core's internals.
const METHODS = new Set([
  'getState',
  'setName',
  'setAvatar',
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
  'setRoomImageTtl'
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

// Waiting for the data lock held by the worklet of a reloaded UI: up to 10 s
const LOCK_ATTEMPTS = 40
const LOCK_DELAY_MS = 250

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
  const init = async (dataDir: string) => {
    // The UI was reloaded by Fast Refresh: the core keeps running (and a 2nd init during
    // the start waits for the same start instead of opening the data twice)
    starting ??= setupI18n()
      .then(() => openCore(dataDir))
      .catch((err) => {
        starting = null // failed: the next init tries again
        throw err
      })
    core = await starting
    return core.getState()
  }

  // A FULL reload of the UI (Metro "r", RR, new dependency) creates a new JS engine, so a
  // new worklet, while the old one still holds the lock on the data (corestore/DEVICE).
  // The old worklet is stopped when its engine is destroyed, but slightly AFTER the new one
  // starts: we wait for the lock to be freed instead of failing straight away.
  const openCore = async (dataDir: string): Promise<P2PCore> => {
    for (let attempt = 1; ; attempt++) {
      const candidate = new P2PCore(dataDir)
      for (const name of EVENTS) candidate.on(name, (...args: unknown[]) => send({ event: name, args }))
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

  const handle = async ({ id, method, args = [] }: Request) => {
    try {
      let result: unknown
      if (method === 'init') result = await init(String(args[0]))
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

  // Run by the harness before the worklet exits: close the swarm and the logs cleanly
  return () => core?.stop()
}
