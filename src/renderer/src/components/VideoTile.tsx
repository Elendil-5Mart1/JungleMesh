//* A video (camera) in a call: participant tile, with the "speaking" ring and an optional diagnostic line
import { useEffect, useRef, type ReactNode } from 'react'

interface VideoTileProps {
  stream: MediaStream
  name: string
  mirror?: boolean // my own camera: mirrored, like in a mirror (the others receive it the right way round)
  speaking?: boolean
  stats?: string[] // diagnostic lines (codec, encoder, fps…), shown on the image
  children?: ReactNode // buttons over the image (e.g. "Stop watching")
}

export const VideoTile = ({ stream, name, mirror, speaking, stats, children }: VideoTileProps) => {
  const ref = useRef<HTMLVideoElement>(null)

  // srcObject is not a React attribute: it is set by hand on the element
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])

  return (
    <figure className={`video-tile ${speaking ? 'video-tile--speaking' : ''}`}>
      {/* muted: the sound of the call is played elsewhere (one <audio> per participant) */}
      <video ref={ref} className={`video-tile__video ${mirror ? 'video-tile__video--mirror' : ''}`} autoPlay playsInline muted />
      {name && <figcaption className="video-tile__name">{name}</figcaption>}
      {stats && stats.length > 0 && (
        <div className="video-tile__stats">
          {stats.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
      {children}
    </figure>
  )
}
