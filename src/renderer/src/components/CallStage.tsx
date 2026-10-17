//* Call "stage", like Discord: the participants of the call, as avatar bubbles or as videos.
// - Nobody has a camera: round bubbles (with the "speaking" ring).
// - At least one camera: every participant becomes a 16:9 tile (avatar in the middle if no camera).
// - Click on a tile: it is put forward (focus), the others go into a strip below.
//   Click on the tile in focus: back to equal sizes.
// - Buttons: taller / smaller band (private call), full screen.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/Avatar'
import { VideoTile } from '@/components/VideoTile'
import { VoiceRing } from '@/components/VoiceRing'
import { Icon } from '@/components/Icon'

export interface StageMember {
  key: string
  name: string
  avatar: string | null
  video?: MediaStream | null // camera (mine or received)
  mirror?: boolean // my own camera
  speaking?: boolean
  note?: string // under the name, e.g. "connecting…"
  noteKind?: string // modifier of the note (connected / failed): its color
  stats?: string[] // video diagnostic lines
  screen?: boolean // shared screen tile (not a person: no right-click menu)
  onWatch?: () => void // screen not watched yet: "Watch" button
  onUnwatch?: () => void // screen watched: "Stop watching" button
}

interface CallStageProps {
  members: StageMember[]
  fill?: boolean // takes the whole height of its parent (voice channel) instead of a band at the top
  onMemberMenu?: (key: string) => (e: React.MouseEvent) => void // right click on a participant
  children?: ReactNode // call buttons, under the participants
}

type Variant = 'grid' | 'main' | 'small'

// Band height remembered between calls (simple convenience, per window)
const TALL_KEY = 'stage:tall'
const loadTall = (): boolean => {
  try {
    return localStorage.getItem(TALL_KEY) === '1'
  } catch {
    return false
  }
}

// Grid as square as possible: 2 → 2×1, 3-4 → 2×2, 5-6 → 3×2…
const gridOf = (n: number): { cols: number; rows: number } => {
  const cols = Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.ceil(n / cols) }
}

export const CallStage = ({ members, fill, onMemberMenu, children }: CallStageProps) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [tall, setTall] = useState(loadTall)
  const [fullscreen, setFullscreen] = useState(false)

  // Leaving full screen with Escape also goes through here
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // A shared screen (even not watched) also switches to tiles: it needs room for its "Watch" button
  const anyVideo = members.some((m) => m.video || m.screen)
  // The person in focus left (or nobody has a camera any more): back to the grid by itself
  const focused = anyVideo ? (members.find((m) => m.key === focus) ?? null) : null
  const others = focused ? members.filter((m) => m !== focused) : members

  const toggleTall = (): void => {
    setTall((on) => {
      try {
        localStorage.setItem(TALL_KEY, on ? '0' : '1')
      } catch {
        // storage unavailable: the choice is only kept until the window closes
      }
      return !on
    })
  }

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void ref.current?.requestFullscreen()
  }

  // Click on a tile: focus on it, or back to equal sizes if it was already in focus
  const clickTile = (key: string): void => {
    if (anyVideo) setFocus((current) => (current === key ? null : key))
  }

  // "Watch": the stream is put forward right away
  const watch = (m: StageMember) => (e: React.MouseEvent) => {
    e.stopPropagation()
    m.onWatch?.()
    setFocus(m.key)
  }
  const unwatch = (m: StageMember) => (e: React.MouseEvent) => {
    e.stopPropagation()
    m.onUnwatch?.()
    setFocus(null)
  }

  // A participant: video, avatar tile (when others have a camera) or bubble (nobody has one)
  const renderMember = (m: StageMember, variant: Variant) => {
    const content = m.video ? (
      <VideoTile
        stream={m.video}
        name={m.name}
        mirror={m.mirror}
        speaking={m.speaking}
        stats={variant === 'small' ? undefined : m.stats}
      >
        {m.onUnwatch && variant !== 'small' && (
          <button type="button" className="stage__unwatch" onClick={unwatch(m)}>
            {t('stage.unwatch')}
          </button>
        )}
      </VideoTile>
    ) : m.screen ? (
      // Screen shared but not watched: nothing is received, just the invitation to watch
      <div className="stage__card stage__card--screen">
        <span className="stage__live">{t('stage.live')}</span>
        {variant !== 'small' && <span className="stage__name">{m.name}</span>}
        {m.onWatch && (
          <button type="button" className="stage__watch" onClick={watch(m)}>
            {variant === 'small' ? <Icon name="play" size={14} /> : t('stage.watch')}
          </button>
        )}
      </div>
    ) : (
      <div className={`stage__card ${anyVideo ? '' : 'stage__card--bubble'}`}>
        <VoiceRing speaking={m.speaking}>
          <Avatar src={m.avatar} name={m.name} size={variant === 'small' ? 36 : anyVideo ? 72 : 80} />
        </VoiceRing>
        {variant !== 'small' && <span className="stage__name">{m.name}</span>}
        {variant !== 'small' && m.note && <span className={`voice__link voice__link--${m.noteKind ?? ''}`}>{m.note}</span>}
      </div>
    )
    return (
      <div
        key={m.key}
        className={`stage__tile stage__tile--${variant}`}
        title={anyVideo ? (variant === 'main' ? t('stage.unfocus') : t('stage.focus')) : undefined}
        onClick={() => clickTile(m.key)}
        onContextMenu={m.screen ? undefined : onMemberMenu?.(m.key)}
      >
        {content}
      </div>
    )
  }

  const { cols, rows } = gridOf(others.length)
  const mode = !anyVideo ? 'bubbles' : focused ? 'focus' : 'grid'

  return (
    <section
      ref={ref}
      className={`stage stage--${mode} ${fill ? 'stage--fill' : tall ? 'stage--tall' : 'stage--band'}`}
    >
      <div className="stage__tools">
        {!fill && !fullscreen && (
          <button type="button" className="stage__tool" title={tall ? t('stage.smaller') : t('stage.taller')} onClick={toggleTall}>
            <Icon name={tall ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        )}
        <button
          type="button"
          className="stage__tool"
          title={fullscreen ? t('stage.exitFullscreen') : t('stage.fullscreen')}
          onClick={toggleFullscreen}
        >
          <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={16} />
        </button>
      </div>

      {mode === 'focus' && focused ? (
        <div className="stage__focus">
          {renderMember(focused, 'main')}
          <div className="stage__strip">{others.map((m) => renderMember(m, 'small'))}</div>
        </div>
      ) : (
        <div
          className={`stage__tiles stage__tiles--${mode}`}
          style={mode === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : undefined}
        >
          {others.map((m) => renderMember(m, 'grid'))}
        </div>
      )}

      {children}
    </section>
  )
}
