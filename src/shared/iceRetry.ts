//* Retrying a WebRTC link that failed (computer and phone)
// A link goes "failed" when no network path works any more (Wi-Fi → 4G, sleeping router, NAT mapping expired).
// The initiator asks for a new path search (restartIce → new offer). One attempt was not always enough:
// if the offer got lost or the network was still changing, the link stayed "failed" until someone hung up.
// Here: an attempt right away, then a check every ICE_RETRY_MS, at most MAX_ICE_RESTARTS times in a row.
// The first attempt is immediate on purpose: on the phone in the background, JS timers are paused,
// so only that one is sure to run before the app comes back.
export const ICE_RETRY_MS = 15_000
export const MAX_ICE_RESTARTS = 3

// What we need from an RTCPeerConnection (the browser's and react-native-webrtc's both fit)
interface Restartable {
  readonly connectionState: string
  restartIce(): void
}

export interface IceRetry {
  failed(): void // the link went "failed"
  connected(): void // the link works (again): the counter starts over
  stop(): void // the link is closed
}

// `alive`: the link is still the current one for this participant (not removed or replaced meanwhile)
export const createIceRetry = (pc: Restartable, alive: () => boolean): IceRetry => {
  let restarts = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const attempt = (): void => {
    timer = null
    if (!alive() || pc.connectionState === 'connected' || restarts >= MAX_ICE_RESTARTS) return
    restarts++
    pc.restartIce()
    timer = setTimeout(attempt, ICE_RETRY_MS) // no answer, or failed again: next attempt
  }
  return {
    // A "failed" event while an attempt is waiting for its check: that check will decide
    failed: () => {
      if (!timer) attempt()
    },
    connected: () => {
      restarts = 0
      clear()
    },
    stop: clear
  }
}
