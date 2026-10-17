//* "Speaking" indicator around an avatar: turquoise ring + animated wave inside the bubble
import type { ReactNode } from 'react'

export const VoiceRing = ({ speaking, children }: { speaking?: boolean; children: ReactNode }) => (
  <span className={`voice-ring ${speaking ? 'voice-ring--speaking' : ''}`}>
    {children}
    {/* When the person speaks: the inside of the bubble becomes an animated wave */}
    {speaking && (
      <span className="voice-wave" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="voice-wave__bar" style={{ animationDelay: `${i * 0.11}s` }} />
        ))}
      </span>
    )}
  </span>
)
