//* Round avatar: image, or the first letter of the name (same look as the desktop, _avatar.scss)
// Optional presence dot at the bottom right, "cut out" of the background like on Discord.
import { Image, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import type { Avatar as AvatarData } from '../../../src/shared/types'
import { colors, fonts } from '../theme'

interface AvatarProps {
  src: AvatarData // 128×128 image as a data URL (data:image/webp;base64,…), or null
  name: string
  size?: number
  status?: 'online' | 'offline' // shows the presence dot
  cutout?: string // color around the dot = background behind the avatar
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?'

export const Avatar = ({ src, name, size = 36, status, cutout = colors.bg }: AvatarProps) => {
  const dot = Math.max(10, Math.round(size * 0.38))
  return (
    <View style={{ width: size, height: size }}>
      {src ? (
        // React Native's <Image> reads data URLs directly
        <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.initials, { width: size, height: size }]}>
          {/* Same background for everyone: night-blue gradient with a hairline (CSS linear-gradient(145deg…)) */}
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="bg" x1="0.2" y1="0" x2="0.8" y2="1">
                <Stop offset="0" stopColor="#1b2636" />
                <Stop offset="1" stopColor="#0a0e15" />
              </LinearGradient>
            </Defs>
            <Circle cx={size / 2} cy={size / 2} r={size / 2 - 0.5} fill="url(#bg)" stroke={colors.border} strokeWidth={1} />
          </Svg>
          <Text style={[styles.letter, { fontSize: size * 0.55, lineHeight: size * 0.75 }]}>{initial(name)}</Text>
        </View>
      )}
      {status && (
        <View
          style={[
            styles.status,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              borderColor: cutout,
              backgroundColor: status === 'online' ? colors.accent : colors.textMuted
            }
          ]}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center' },
  // Large white letter with a small turquoise halo
  letter: {
    color: '#fff',
    fontFamily: fonts.mono,
    fontWeight: '700',
    textShadowColor: 'rgba(31, 209, 200, 0.55)',
    textShadowRadius: 8
  },
  status: { position: 'absolute', right: -2, bottom: -2, borderWidth: 3 }
})
