//* YouTube thumbnails of a message, mobile version (no player in the app: a tap opens the video)
// The images come WITH the message (downloaded by its sender, see src/thumbs.ts): showing them contacts
// nobody. A link without a thumbnail (older version, download failed) stays a plain link in the text.
import { memo, useMemo } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { embedsOf } from '../../../src/shared/embeds'
import type { Thumbs } from '../../../src/shared/types'
import { Icon } from './Icon'
import { colors, radius, space } from '../theme'

const YOUTUBE_RED = '#ff0033' // the desktop card's colour (_embed.scss)
const WIDTH = 280 // a mqdefault is 320×180: a bit smaller, it stays sharp

interface Props {
  text: string
  thumbs?: Thumbs
  onLongPress: () => void // the message menu, as on the rest of the bubble
}

// memo: the links are only searched again when the text changes (an edit)
export const YouTubeThumbs = memo(({ text, thumbs, onLongPress }: Props) => {
  const cards = useMemo(
    () => (thumbs ? embedsOf(text).filter((e) => e.videoId && thumbs[e.videoId]) : []),
    [text, thumbs]
  )
  if (cards.length === 0) return null
  return (
    <View style={styles.list}>
      {cards.map((e) => (
        <Pressable
          key={e.src}
          onPress={() => void Linking.openURL(e.url)} // https only: embedsOf already checked it
          onLongPress={onLongPress}
          delayLongPress={350}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityLabel={`YouTube ${e.url}`}
        >
          <View>
            <Image source={{ uri: thumbs![e.videoId!] }} style={styles.image} resizeMode="cover" />
            <View style={styles.overlay}>
              <View style={styles.play}>
                <Icon name="play" size={24} color="#fff" />
              </View>
            </View>
          </View>
          <Text style={styles.provider}>YouTube</Text>
        </Pressable>
      ))}
    </View>
  )
})

const styles = StyleSheet.create({
  list: { gap: space, marginTop: space / 2 },
  card: {
    width: WIDTH,
    maxWidth: '100%',
    borderRadius: radius,
    borderLeftWidth: 3,
    borderLeftColor: YOUTUBE_RED,
    backgroundColor: colors.bgSoft,
    overflow: 'hidden'
  },
  pressed: { opacity: 0.8 },
  image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  // Round "play" in the middle of the image
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  play: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  provider: { color: YOUTUBE_RED, fontWeight: 'bold', fontSize: 12, paddingHorizontal: space, paddingVertical: space / 2 }
})
