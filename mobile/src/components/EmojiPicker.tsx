//* Full emoji picker of the phone (reactions): categories + search, 100% local (no network)
// Mobile counterpart of src/renderer/src/components/EmojiPicker.tsx, with the same data (emojibase) and
// the same categories. Opened from the "+" at the end of the quick reactions (long press on a message).
// Writing an emoji in a message does not need it: the phone's keyboard has its own.
import { useMemo, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { colors, radius, space } from '../theme'

const GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9] // group 2 = skin tone components, useless alone
const CELL = 46 // width of a grid cell (emoji + touch margin)

interface Emoji {
  unicode: string
  label: string
  tags: string[]
  group: number
}

interface EmojibaseEntry {
  emoji: string
  label: string
  tags?: string[]
  group?: number
  version: number
}

// Newest emoji version the phone can draw (otherwise empty boxes): Android 10 = Emoji 12, 11 and 12 = 13,
// 13 = 14, 14 and later = 15 (the desktop stops at 15 too)
const maxVersion = (): number => {
  if (Platform.OS !== 'android') return 15
  const api = Number(Platform.Version)
  return api >= 34 ? 15 : api >= 33 ? 14 : api >= 30 ? 13 : 12
}

// Loaded at the first opening: the ~700 KB of data stay out of the app's startup
let cache: Emoji[] | null = null
const allEmoji = (): Emoji[] => {
  if (cache) return cache
  const data = require('emojibase-data/en/data.json') as EmojibaseEntry[]
  const max = maxVersion()
  // Skin variants are left out (an emoji's `skins` field): the base emoji is enough, as on the desktop
  cache = data
    .filter((e) => e.group !== undefined && GROUPS.includes(e.group) && e.version <= max)
    .map((e) => ({ unicode: e.emoji, label: e.label, tags: e.tags ?? [], group: e.group! }))
  return cache
}

interface EmojiPickerProps {
  visible: boolean
  onPick: (emoji: string) => void
  onClose: () => void
}

export const EmojiPicker = ({ visible, onPick, onClose }: EmojiPickerProps) => {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [group, setGroup] = useState(0)
  const [query, setQuery] = useState('')
  const columns = Math.max(5, Math.floor((width - space * 2) / CELL))

  // Nothing is computed while closed (the list is not even loaded)
  const all = visible ? allEmoji() : null
  const shown = useMemo(() => {
    if (!all) return []
    const q = query.trim().toLowerCase()
    if (!q) return all.filter((e) => e.group === group)
    return all.filter((e) => e.label.includes(q) || e.tags.some((tag) => tag.includes(q))).slice(0, 200)
  }, [all, group, query])

  const close = () => {
    setQuery('')
    onClose()
  }

  const pick = (emoji: string) => {
    setQuery('')
    onPick(emoji)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {/* Dark backdrop: a tap outside closes the picker */}
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { height: height * 0.6, paddingBottom: space + insets.bottom }]}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={t('emoji.search')}
            placeholderTextColor={colors.textDim}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {!query && all && (
            <View style={styles.tabs}>
              {GROUPS.map((g) => (
                <Pressable
                  key={g}
                  onPress={() => setGroup(g)}
                  accessibilityLabel={t(`emoji.group${g}`)}
                  hitSlop={4}
                  style={[styles.tab, g === group && styles.tabActive]}
                >
                  <Text style={styles.tabEmoji}>{all.find((e) => e.group === g)?.unicode}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <FlatList
            key={columns} // a FlatList cannot change its number of columns once mounted
            data={shown}
            numColumns={columns}
            keyExtractor={(e) => e.unicode}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={columns * 8}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => pick(item.unicode)}
                accessibilityLabel={item.label}
                style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
              >
                <Text style={styles.emoji}>{item.unicode}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.none}>{t('emoji.none')}</Text>}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  sheet: {
    backgroundColor: colors.bgDeep,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderTopLeftRadius: radius * 2,
    borderTopRightRadius: radius * 2,
    paddingTop: space * 1.5,
    paddingHorizontal: space,
    gap: space
  },
  search: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },
  tabs: { flexDirection: 'row', justifyContent: 'space-between' },
  tab: { padding: space / 2, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.accent },
  tabEmoji: { fontSize: 22 },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: radius },
  cellPressed: { backgroundColor: colors.bgSoft },
  emoji: { fontSize: 28 },
  none: { color: colors.textMuted, textAlign: 'center', padding: space * 2 }
})
