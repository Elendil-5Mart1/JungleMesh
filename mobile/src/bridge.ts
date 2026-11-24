//* Bridge to the Bare worker: the mobile equivalent of the desktop's preload (window.api)
// call('setName', 'Alice') sends { id, method, args } to the worker and returns a Promise
// resolved with its answer. Core events (state, message…) are delivered to on(...) listeners.
import b4a from 'b4a'
import { AppState, type AppStateStatus } from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import worker from 'expo-bare-kit/workers/worker/index'

type Listener = (...args: any[]) => void

let ipc: any = null
let nextId = 1
let buffered = '' // IPC chunks are not aligned on messages: keep the incomplete end
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, Set<Listener>>()

//& Messages from the worker (one JSON object per line)
const onLine = (line: string) => {
  const msg = JSON.parse(line)
  if (msg.event) {
    for (const fn of listeners.get(msg.event) ?? []) fn(...msg.args)
    return
  }
  const wait = pending.get(msg.id)
  if (!wait) return
  pending.delete(msg.id)
  if (msg.error) wait.reject(new Error(msg.error))
  else wait.resolve(msg.result)
}

//& Starting the worklet (once for the whole app)
let starting: Promise<void> | null = null

export const startWorker = (): Promise<void> => {
  starting ??= worker.start().then(({ ipc: stream }) => {
    ipc = stream
    ipc.on('data', (chunk: Uint8Array) => {
      buffered += b4a.toString(chunk)
      let end: number
      while ((end = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        if (line) onLine(line)
      }
    })
  })
  return starting
}

//& Keeping the worker awake in the background (during a call)
// react-native-bare-kit suspends the worklet by itself when the app goes to the background: it listens to
// AppState and calls update('background') → suspend() on every worklet. Not Android: a JS decision, so
// we can override update(). expo-bare-kit does not hand us its worklet, so the override goes on the class
// (we only have one worker). While a call runs in the background (foreground service), the suspend is
// skipped; it happens when the call ends, if the app is still in the background.
let awake = false
const originalUpdate = Worklet.prototype.update
Worklet.prototype.update = function (state?: AppStateStatus) {
  const current = state ?? (AppState.currentState as AppStateStatus) // same default as bare-kit
  if (awake && current === 'background') return
  originalUpdate.call(this, current)
}

export const keepWorkerAwake = (on: boolean): void => {
  if (awake === on) return
  awake = on
  if (!on && AppState.currentState === 'background') Worklet.update('background')
}

//& Calling the core
export const call = async <T = unknown>(method: string, ...args: unknown[]): Promise<T> => {
  await startWorker()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ipc.write(b4a.from(JSON.stringify({ id, method, args }) + '\n'))
  })
}

// Subscribe to a core event; returns the unsubscribe function (handy in a useEffect)
export const on = (event: string, fn: Listener): (() => void) => {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(fn)
  return () => listeners.get(event)?.delete(fn)
}
