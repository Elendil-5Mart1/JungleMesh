//* Attachment of a message.
// - Image: shown in the chat at the width of the message (down to its natural size), a download arrow
//   appears on hover, and it disappears after the delay chosen by the user (or by the room's creator).
// - Other file: a card; nothing is transferred until the receiver accepts and picks where to save it,
//   then a progress bar follows the transfer.
// - Audio (mp3, ogg, wav, flac, m4a): the same card with a play button; the bytes are only fetched on that
//   click, then played by an <audio> player (samples, demos…).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../shared/types'
import { cleanError } from '@/utils/errors'
import { Icon } from '@/components/Icon'

const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

interface FileCardProps {
  file: NonNullable<ChatMessage['file']>
  ts: number // date of the message (the delay of an image counts from there)
  ttlHours: number // lifetime of images in this conversation, 0 = never
}

export const FileCard = ({ file, ts, ttlHours }: FileCardProps) => {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [naturalWidth, setNaturalWidth] = useState<number | undefined>()
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [transfer, setTransfer] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState<number | null>(null) // 0 → 1, null = not started yet
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [zoomed, setZoomed] = useState(false) // image shown full window
  const isAudio = file.mime.startsWith('audio/')
  const [audioUrl, setAudioUrl] = useState<string | null>(null) // Blob URL once fetched
  const [audioLoading, setAudioLoading] = useState(false)

  // The Blob of the player is released with the card (window closed, message deleted…)
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl])

  // Full-window image: Escape closes it (a click anywhere too, see below)
  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZoomed(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [zoomed])

  // Image lifetime: checked every minute while the window is open (the main process erases the data from disk)
  const expired = file.image && ttlHours > 0 && now - Math.min(ts, now) > ttlHours * 3_600_000
  useEffect(() => {
    if (!file.image || ttlHours <= 0) return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [file.image, ttlHours])

  // Image: fetched (and checked by the main process) as soon as the message is displayed, unless it has expired
  useEffect(() => {
    if (!file.image || expired) {
      setSrc(null)
      return
    }
    let cancelled = false
    window.api
      .getImage(file.core)
      .then((url) => !cancelled && (setSrc(url), setLoadState('ready')))
      .catch((err) => !cancelled && (setLoadState('failed'), setNote(cleanError(err))))
    return () => {
      cancelled = true
    }
  }, [file.core, file.image, expired])

  // Progress of a transfer I started (listened to only during the transfer: a long conversation full of
  // images would otherwise hang one IPC listener per attachment)
  useEffect(() => {
    if (transfer !== 'running' && !audioLoading) return
    return window.api.onFileProgress((key, done, total) => {
      if (key === file.core) setProgress(done / total)
    })
  }, [file.core, transfer, audioLoading])

  // "Play": fetches the audio (with the same progress bar as a download), then the player starts by itself
  const play = async (): Promise<void> => {
    setNote('')
    setProgress(null)
    setAudioLoading(true)
    try {
      const { mime, bytes } = await window.api.getAudio(file.core)
      setAudioUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })))
    } catch (err) {
      setNote(cleanError(err))
    } finally {
      setAudioLoading(false)
    }
  }

  // "Download": the destination dialog comes first, the transfer starts once it is chosen
  const download = async (): Promise<void> => {
    setNote('')
    setProgress(null)
    setTransfer('running')
    try {
      const saved = await window.api.saveFile(file.core, file.name)
      setTransfer(saved ? 'done' : 'idle')
    } catch (err) {
      setTransfer('idle')
      setNote(cleanError(err))
    }
  }

  //& Image
  if (file.image && expired) return <p className="attachment__hint">{t('file.expired')}</p>
  if (file.image && loadState !== 'failed') {
    return (
      <div className="attachment attachment--image">
        {src ? (
          <div className="attachment__frame" style={{ maxWidth: naturalWidth }}>
            <img
              className="attachment__image"
              src={src}
              alt={file.name}
              onLoad={(e) => setNaturalWidth(e.currentTarget.naturalWidth)}
              onClick={() => setZoomed(true)}
            />
            <button
              type="button"
              className="attachment__arrow"
              title={t('file.download')}
              aria-label={t('file.download')}
              onClick={() => void download()}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
              </svg>
            </button>
          </div>
        ) : (
          <p className="attachment__hint">{t('file.loading')}</p>
        )}
        {transfer === 'done' && <p className="attachment__hint">{t('file.saved')}</p>}
        {note && <p className="attachment__hint attachment__hint--error">{note}</p>}
        {/* position: fixed, like the modals: stays inside the window's chamfered frame */}
        {zoomed && src && (
          <div className="lightbox" role="dialog" aria-label={file.name} onClick={() => setZoomed(false)}>
            <img className="lightbox__image" src={src} alt={file.name} />
            <p className="lightbox__caption">{file.name}</p>
          </div>
        )}
      </div>
    )
  }

  //& Other file (or an image that could not be displayed: it can still be downloaded)
  return (
    <div className="attachment">
      <div className="attachment__row">
        {isAudio && !audioUrl ? (
          <button
            type="button"
            className="attachment__play"
            title={t('file.play')}
            aria-label={t('file.play')}
            disabled={audioLoading}
            onClick={() => void play()}
          >
            <Icon name="play" size={16} />
          </button>
        ) : (
          <Icon name="file" size={18} />
        )}
        <span className="attachment__name" title={file.name}>
          {file.name}
        </span>
        <span className="attachment__size">{formatSize(file.size)}</span>
        {transfer === 'idle' && (
          <button type="button" className="attachment__btn" onClick={() => void download()}>
            {t('file.accept')}
          </button>
        )}
        {transfer === 'done' && <span className="attachment__size">{t('file.saved')}</span>}
      </div>
      {audioUrl && <audio className="attachment__audio" src={audioUrl} controls autoPlay />}
      {(transfer === 'running' || audioLoading) && (
        <div className="attachment__bar" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)}>
          <div
            className={`attachment__fill ${progress === null ? 'attachment__fill--waiting' : ''}`}
            style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
      {note && <p className="attachment__hint attachment__hint--error">{note}</p>}
    </div>
  )
}
