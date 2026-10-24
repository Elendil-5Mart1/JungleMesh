//* Players of the playable links of a message (YouTube, SoundCloud…), like on Discord
// Without a server in between, showing a player reveals OUR IP to the platform (even without playing):
// by default the card only shows the link and a "play" button, the player loads on click.
// Settings › Privacy › "Load players automatically" loads them straight away (without autoplay).
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCoreStore } from '@/stores/useCoreStore'
import { Icon } from '@/components/Icon'
import { embedsOf, PROVIDER_NAMES, type Embed } from '@/utils/embeds'

// Link shown on the card: without https:// and www., cut if too long
const shortLink = (url: string): string => {
  const bare = url.replace(/^https?:\/\/(www\.)?/, '')
  return bare.length > 60 ? `${bare.slice(0, 57)}…` : bare
}

//& One player
const EmbedCard = ({ embed, auto }: { embed: Embed; auto: boolean }) => {
  const { t } = useTranslation()
  // null = not loaded; otherwise "clicked" (autoplay) or loaded by the setting (no autoplay)
  const [loaded, setLoaded] = useState<'clicked' | 'auto' | null>(auto ? 'auto' : null)
  const name = PROVIDER_NAMES[embed.provider]
  const src = loaded === 'clicked' && embed.autoplay ? `${embed.src}&${embed.autoplay}` : embed.src
  const shape = embed.height ? 'audio' : embed.vertical ? 'vertical' : 'video'

  return (
    <div className={`embed embed--${embed.provider} embed--${shape}`}>
      <header className="embed__head">
        <span className="embed__provider">{name}</span>
        <a className="embed__link" href={embed.url} target="_blank" rel="noreferrer" title={embed.url}>
          {shortLink(embed.url)}
        </a>
        {loaded && (
          // Unload: stops the sound and frees the player (heavy, especially YouTube)
          <button type="button" className="embed__close" title={t('embed.close')} aria-label={t('embed.close')} onClick={() => setLoaded(null)}>
            <Icon name="close" size={14} />
          </button>
        )}
      </header>
      {loaded ? (
        <iframe
          className="embed__frame"
          src={src}
          title={name}
          style={embed.height ? { height: embed.height } : undefined}
          // The page of the player runs in its own sandbox: no navigation of our window, no form sent to us.
          // Popups ("Watch on YouTube") go through the window open handler, so through the link confirmation.
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="embed__play" onClick={() => setLoaded('clicked')}>
          <Icon name="play" size={18} />
          <span>
            <strong>{t('embed.play')}</strong>
            <small>{t('embed.privacy', { name })}</small>
          </span>
        </button>
      )}
    </div>
  )
}

// memo: the links are only searched again when the text changes (an edit), not on every render of the row
export const Embeds = memo(({ text }: { text: string }) => {
  const auto = useCoreStore((s) => !!s.settings?.autoEmbeds)
  const embeds = useMemo(() => embedsOf(text), [text])
  if (embeds.length === 0) return null
  return (
    <div className="embeds">
      {embeds.map((e) => (
        <EmbedCard key={e.src} embed={e} auto={auto} />
      ))}
    </div>
  )
})
