//* Per-person listening volume in voice channels (0 → 1), remembered on this device only
const KEY = (member: string): string => `voice:volume:${member}`

export const getVoiceVolume = (member: string): number => {
  try {
    const stored = Number(localStorage.getItem(KEY(member)))
    return localStorage.getItem(KEY(member)) !== null && Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 1
  } catch {
    return 1
  }
}

export const saveVoiceVolume = (member: string, volume: number): void => {
  try {
    if (volume >= 1) localStorage.removeItem(KEY(member)) // default value: nothing to remember
    else localStorage.setItem(KEY(member), String(volume))
  } catch {
    /* storage unavailable: the volume just won't be remembered */
  }
}
