//* Tiles of the shared screens in the call stage (private calls and voice channels alike):
// mine (preview + number of viewers) and those of the others (watched or with a "Watch" button)
import { t } from '../../../shared/i18n'
import type { StageMember } from '@/components/CallStage'
import type { useVoice } from './useVoice'
import { myScreenLines, screenLines } from './useVideoStats'
import type { LinkStats } from './VoiceSession'

interface Person {
  key: string
  name: string
  avatar: string | null
}

export const screenTiles = (
  voice: ReturnType<typeof useVoice>,
  people: Person[], // participants of the call, me included
  myKey: string,
  stats?: Record<string, LinkStats> // undefined = diagnostic hidden
): StageMember[] => {
  const status = voice.status
  if (!status) return []
  const tiles: StageMember[] = []
  for (const p of people) {
    const mine = p.key === myKey
    if (mine ? !status.screen : !status.sharing.includes(p.key)) continue
    const watched = !mine && !!status.screens[p.key]
    tiles.push({
      key: `${p.key}:screen`,
      name: mine ? t('stage.myScreen', { count: status.viewers }) : t('stage.screenOf', { name: p.name }),
      avatar: p.avatar,
      screen: true,
      video: mine ? status.localScreen : status.screens[p.key] ?? null,
      onWatch: mine || watched ? undefined : () => voice.watchScreen(p.key, true),
      onUnwatch: watched ? () => voice.watchScreen(p.key, false) : undefined,
      stats: stats && (mine ? myScreenLines(stats) : screenLines(stats[p.key]))
    })
  }
  return tiles
}
