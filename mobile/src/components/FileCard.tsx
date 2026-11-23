//* Attachment of a message (mobile counterpart of src/renderer/src/components/FileCard.tsx)
// - Image: shown in the chat at the width of the message, a tap opens it full screen (with "Download"),
//   and it disappears after its lifetime (the room creator's choice, or 3 days as the core's default).
// - Other file: a card; nothing is transferred until the user taps "Accept and save…", then a progress
//   bar follows the transfer. The file lands in the download folder chosen once (see files.ts).
// - No audio player on the phone yet: a sound is a plain file card.
import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../src/shared/types'
import { on } from '../bridge'
import { formatSize, imageDataUrl, saveAttachment } from '../files'
import { Button } from './Button'
import { Icon } from './Icon'
import { colors, radius, space } from '../theme'

interface FileCardProps {
  file: NonNullable<ChatMessage['file']>
  ts: number // date of the message (the lifetime of an image counts from there)
  ttlHours: number // lifetime of images in this conversation, 0 = never
  convId: string // friend or room: where the receipt goes once saved
  mine: boolean // I sent it
  onLongPress?: () => void // the message's menu (the image takes the touches of its area)
}

export const FileCard = ({ file, ts, ttlHours, convId, mine, onLongPress }: FileCardProps) => {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [ratio, setRatio] = useState(4 / 3) // width / height, known once the image is loaded
  const [failed, setFailed] = useState(false) // image that could not be displayed: a plain card instead
  const [transfer, setTransfer] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState<number | null>(null) // 0 → 1, null = not started yet
  const [note, setNote] = useState('')
  const [zoomed, setZoomed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Image lifetime: checked every minute while the conversation is open (the core frees the data itself)
  const expired = file.image && ttlHours > 0 && now - Math.min(ts, now) > ttlHours * 3_600_000
  useEffect(() => {
    if (!file.image || ttlHours <= 0) return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [file.image, ttlHours])

  // Image: fetched as soon as the message is displayed (from the sender if needed), unless it has expired
  useEffect(() => {
    if (!file.image || expired) return setSrc(null)
    let cancelled = false
    imageDataUrl(file.core)
      .then((url) => {
        if (cancelled) return
        setSrc(url)
        Image.getSize(url, (w, h) => !cancelled && h > 0 && setRatio(w / h))
      })
      .catch((err) => {
        if (cancelled) return
        setFailed(true)
        setNote(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [file.core, file.image, expired])

  // Progress of a transfer I started (listened to only during the transfer)
  useEffect(() => {
    if (transfer !== 'running') return
    return on('file-progress', (key: string, done: number, total: number) => {
      if (key === file.core && total > 0) setProgress(done / total)
    })
  }, [file.core, transfer])

  const download = async () => {
    setNote('')
    setProgress(null)
    setTransfer('running')
    try {
      setTransfer((await saveAttachment(convId, file)) ? 'done' : 'idle')
    } catch (err) {
      setTransfer('idle')
      setNote(err instanceof Error ? err.message : String(err))
    }
  }

  const bar = transfer === 'running' && (
    <View style={styles.bar}>
      {/* Not started yet (sender being reached): a dimmed full bar */}
      <View style={[styles.fill, progress === null ? styles.waiting : { width: `${Math.round(progress * 100)}%` }]} />
    </View>
  )
  const status = transfer === 'done' ? <Text style={styles.hint}>{t('file.saved')}</Text> : null
  const error = note ? <Text style={[styles.hint, styles.error]}>{note}</Text> : null

  //& Image
  if (file.image && expired) return <Text style={styles.hint}>{t('file.expired')}</Text>
  if (file.image && !failed) {
    return (
      <View style={styles.image}>
        {src ? (
          <Pressable onPress={() => setZoomed(true)} onLongPress={onLongPress} delayLongPress={350}>
            <Image source={{ uri: src }} style={[styles.picture, { aspectRatio: ratio }]} resizeMode="contain" accessibilityLabel={file.name} />
          </Pressable>
        ) : (
          <Text style={styles.hint}>{t('file.loading')}</Text>
        )}
        {bar}
        {status}
        {error}
        {/* Full screen: tap anywhere to close, "Download" saves it to the download folder */}
        <Modal visible={zoomed && !!src} transparent animationType="fade" onRequestClose={() => setZoomed(false)} statusBarTranslucent>
          <SafeAreaView style={styles.lightbox}>
            <Pressable style={styles.lightboxImage} onPress={() => setZoomed(false)}>
              {src && <Image source={{ uri: src }} style={styles.full} resizeMode="contain" accessibilityLabel={file.name} />}
            </Pressable>
            <View style={styles.lightboxBar}>
              <Text style={styles.caption} numberOfLines={1}>
                {file.name}
              </Text>
              <Pressable
                onPress={() => {
                  setZoomed(false)
                  void download()
                }}
                disabled={transfer === 'running'}
                accessibilityLabel={t('file.download')}
                hitSlop={8}
                style={({ pressed }) => [styles.round, pressed && styles.pressed]}
              >
                <Icon name="download" size={22} color={colors.text} />
              </Pressable>
              <Pressable onPress={() => setZoomed(false)} hitSlop={8} style={({ pressed }) => [styles.round, pressed && styles.pressed]}>
                <Icon name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    )
  }

  //& Other file (or an image that could not be displayed: it can still be saved)
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Icon name="file" size={20} color={colors.textMuted} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {file.name}
          </Text>
          <Text style={styles.size}>
            {formatSize(file.size)}
            {mine && !!file.receivedBy?.length && `  ·  ${t('file.received', { count: file.receivedBy.length })}`}
          </Text>
        </View>
      </View>
      {transfer === 'idle' && !file.gone && <Button label={t('file.accept')} onPress={() => void download()} />}
      {file.gone && transfer !== 'done' && <Text style={styles.hint}>{t('file.gone')}</Text>}
      {bar}
      {status}
      {error}
    </View>
  )
}

//& Styles
const styles = StyleSheet.create({
  image: { marginTop: space / 2, gap: space / 2 },
  picture: { width: '100%', maxHeight: 360, borderRadius: radius, backgroundColor: colors.bgDeep },
  hint: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  error: { color: colors.danger },
  pressed: { opacity: 0.6 },

  card: {
    marginTop: space / 2,
    gap: space,
    padding: space * 1.25,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.bgSoft
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15 },
  size: { color: colors.textMuted, fontSize: 12 },

  bar: { height: 6, justifyContent: 'center', borderRadius: 3, backgroundColor: colors.bgDeep, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  waiting: { width: '100%', opacity: 0.25 },

  lightbox: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.94)' },
  lightboxImage: { flex: 1 },
  full: { width: '100%', height: '100%' },
  lightboxBar: { flexDirection: 'row', alignItems: 'center', gap: space, padding: space * 1.5 },
  caption: { flex: 1, color: colors.textMuted },
  round: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.bgSoft
  }
})
