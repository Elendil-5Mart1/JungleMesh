//* React hook: video diagnostic of the call, refreshed every 2 s ONLY while it is displayed
// (getStats is cheap, but there is no reason to run it for nothing)
import { useEffect, useState, type RefObject } from 'react'
import { t } from '../../../shared/i18n'
import type { LinkStats, VideoStat, VoiceSession } from './VoiceSession'

const REFRESH_MS = 2000

export const useVideoStats = (session: RefObject<VoiceSession | null>, enabled: boolean) => {
  const [stats, setStats] = useState<Record<string, LinkStats>>({})

  useEffect(() => {
    if (!enabled) return setStats({})
    let alive = true
    const tick = async (): Promise<void> => {
      const next = await session.current?.videoStats()
      if (alive && next) setStats(next)
    }
    void tick()
    const timer = setInterval(() => void tick(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled, session])

  return stats
}

// "↑ H264 · MediaFoundationVideoEncodeAccelerator (hardware) · 1280×720 · 30 fps · 1150 kb/s"
export const formatStat = (arrow: string, s: VideoStat | null): string | null => {
  if (!s) return null
  const hw = s.hardware === null ? '' : ` (${s.hardware ? t('room.statsHw') : t('room.statsSw')})`
  return `${arrow} ${s.codec} · ${s.impl}${hw} · ${s.width}×${s.height} · ${s.fps} fps · ${s.kbps} kb/s`
}

// Lines to show on a participant's tile: what I send them, what I receive from them
export const statLines = (s: LinkStats | undefined): string[] =>
  [formatStat('↑', s?.sent ?? null), formatStat('↓', s?.received ?? null)].filter((l): l is string => !!l)

// Same for the shared screens: what I receive of theirs, or what I send of mine (one line per viewer)
export const screenLines = (s: LinkStats | undefined): string[] =>
  [formatStat('↓', s?.screenReceived ?? null)].filter((l): l is string => !!l)
export const myScreenLines = (all: Record<string, LinkStats>): string[] =>
  Object.values(all)
    .map((s) => formatStat('↑', s.screenSent))
    .filter((l): l is string => !!l)
