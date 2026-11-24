//* Player of a shared sound (the desktop's <audio controls>): play/pause, a bar to seek, the times
// The sound is a file of the app's cache (see fetchAudio in files.ts), deleted when the player goes away.
// expo-audio plays it in the app only: no background playback, no notification (see app.json).
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import type { File } from 'expo-file-system'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { colors, fonts, space } from '../theme'

// 75 s → "1:15"
const clock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const AudioPlayer = ({ file }: { file: File }) => {
  const { t } = useTranslation()
  const player = useAudioPlayer(file.uri)
  const status = useAudioPlayerStatus(player)
  const [width, setWidth] = useState(0)

  // Starts by itself once loaded (the user just tapped "Play"), like the desktop's autoPlay
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (status.isLoaded && !started) {
      setStarted(true)
      player.play()
    }
  }, [status.isLoaded, started, player])

  // The cache copy goes with the player (the hook releases the player itself)
  useEffect(
    () => () => {
      try {
        file.delete()
      } catch {
        // already gone
      }
    },
    [file]
  )

  const toggle = () => {
    if (status.playing) return player.pause()
    // Finished: back to the start before playing again
    if (status.duration > 0 && status.currentTime >= status.duration - 0.1) void player.seekTo(0)
    player.play()
  }

  const ratio = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0

  return (
    <View style={styles.player}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        accessibilityLabel={t('file.play')}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Icon name={status.playing ? 'pause' : 'play'} size={18} color={colors.onAccent} />
      </Pressable>
      {/* Tap on the bar = jump there */}
      <Pressable
        style={styles.track}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => width > 0 && status.duration > 0 && void player.seekTo((e.nativeEvent.locationX / width) * status.duration)}
      >
        <View style={styles.rail}>
          <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
        </View>
      </Pressable>
      <Text style={styles.time}>
        {clock(status.currentTime)} / {clock(status.duration)}
      </Text>
    </View>
  )
}

//& Styles
const styles = StyleSheet.create({
  player: { flexDirection: 'row', alignItems: 'center', gap: space },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent
  },
  pressed: { opacity: 0.6 },
  track: { flex: 1, height: 32, justifyContent: 'center' }, // tall touch zone, thin rail
  rail: { height: 4, borderRadius: 2, backgroundColor: colors.bgDeep, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  time: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11 }
})
