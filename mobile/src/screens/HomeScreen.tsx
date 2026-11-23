//* Home screen: profile, pending requests/invitations, rooms and friends
// Mobile counterpart of src/renderer/src/views/HomeView.tsx (same layout, same texts home.*).
// Differences for a phone: the "+" buttons are real buttons (bigger touch target), and the
// invite code with its Copy/Share buttons lives in the settings screen (gear).
import { useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Trans, useTranslation } from 'react-i18next'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { MAX_CUSTOM_STATUS, type Friend, type Room } from '../../../src/shared/types'
import { changeMyAvatar } from '../avatar'
import { call } from '../bridge'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { ActionSheet, type SheetSpec } from '../components/Sheet'
import { report } from '../report'
import { useCore } from '../store'
import { WelcomeScreen } from './WelcomeScreen'
import { colors, fonts, radius, space } from '../theme'

const openRoom = (key: string) => router.push({ pathname: '/room/[key]', params: { key } })
const openChat = (key: string) => router.push({ pathname: '/chat/[key]', params: { key } })

//& My name: plain text with a pencil next to it; a field only while editing (like the desktop)
const NameEditor = ({ name }: { name: string }) => {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1} onLongPress={() => setEditing(true)}>
          {name}
        </Text>
        <Pressable onPress={() => setEditing(true)} hitSlop={10} accessibilityLabel={t('home.nameHint')}>
          <Icon name="pencil" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    )
  }

  const save = (value: string) => {
    setEditing(false)
    const clean = value.trim()
    if (clean && clean !== name) void call('setName', clean)
  }

  return (
    <TextInput
      style={[styles.name, styles.nameEditing]}
      defaultValue={name}
      maxLength={32}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      onEndEditing={(e) => save(e.nativeEvent.text)}
    />
  )
}

//& My custom status under the name (like Discord): same editing as the name, '' = no status
const StatusEditor = ({ status }: { status: string }) => {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <Pressable onPress={() => setEditing(true)} hitSlop={6} accessibilityLabel={t('home.statusHint')}>
        <Text style={status ? styles.status : styles.key} numberOfLines={1}>
          {status || t('home.statusPlaceholder')}
        </Text>
      </Pressable>
    )
  }

  const save = (value: string) => {
    setEditing(false)
    if (value.trim() !== status) void call('setCustomStatus', value.trim())
  }

  return (
    <TextInput
      style={[styles.status, styles.nameEditing]}
      defaultValue={status}
      placeholder={t('settings.statusPlaceholder')}
      placeholderTextColor={colors.textDim}
      maxLength={MAX_CUSTOM_STATUS}
      autoFocus
      returnKeyType="done"
      onEndEditing={(e) => save(e.nativeEvent.text)}
    />
  )
}

//& New version available (see updates.ts): download in the browser, or hide until the next check
const UpdateBanner = () => {
  const { t } = useTranslation()
  const update = useCore((s) => s.update)
  const setUpdate = useCore((s) => s.setUpdate)
  if (!update) return null
  return (
    <View style={styles.update}>
      <Text style={styles.strong}>{t('update.available', { version: update.version })}</Text>
      <Text style={styles.muted}>{t('update.mobileDetail')}</Text>
      <View style={styles.buttons}>
        <Button label={t('update.download')} kind="primary" onPress={() => void Linking.openURL(update.url)} />
        <Button label={t('update.later')} onPress={() => setUpdate(null)} />
      </View>
    </View>
  )
}

//& Turquoise line that fades out under the profile (signature of the theme, border-image on the desktop)
const AccentLine = () => (
  <Svg height={1} width="100%">
    <Defs>
      <LinearGradient id="line" x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor={colors.accent} stopOpacity={0.55} />
        <Stop offset="0.75" stopColor={colors.accent} stopOpacity={0} />
      </LinearGradient>
    </Defs>
    <Rect width="100%" height={1} fill="url(#line)" />
  </Svg>
)

//& Section title "// ROOMS" with its "+" button
interface SectionTitleProps {
  label: string
  open?: boolean // form shown: the "+" becomes a "×"
  onToggle?: () => void
  addLabel?: string // accessibility label of the "+"
}

const SectionTitle = ({ label, open, onToggle, addLabel }: SectionTitleProps) => (
  <View style={styles.sectionTitle}>
    <Text style={styles.label}>//{label}</Text>
    {onToggle && (
      <Pressable
        onPress={onToggle}
        accessibilityLabel={addLabel}
        hitSlop={6}
        style={({ pressed }) => [styles.add, open && styles.addOpen, pressed && styles.pressed]}
      >
        <Icon name={open ? 'close' : 'plus'} size={22} color={open ? colors.onAccent : colors.accent} />
      </Pressable>
    )}
  </View>
)

//& Inline form under a section title (create a room, add a friend)
interface InlineFormProps {
  placeholder: string
  submitLabel: string
  onSubmit: (value: string) => Promise<void>
  code?: boolean // invite code: no capitals or corrections
}

const InlineForm = ({ placeholder, submitLabel, onSubmit, code }: InlineFormProps) => {
  const [value, setValue] = useState('')
  const submit = () => {
    if (value.trim()) void onSubmit(value.trim()).then(() => setValue(''))
  }
  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={submit}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        autoFocus
        autoCapitalize={code ? 'none' : 'sentences'}
        autoCorrect={!code}
        maxLength={code ? undefined : 64}
        returnKeyType="done"
      />
      <Button label={submitLabel} kind="primary" onPress={submit} disabled={!value.trim()} />
    </View>
  )
}

//& One line of a list (room or friend)
interface RowProps {
  avatar: React.ReactNode
  name: string
  sub?: string // custom status of a friend, under the name
  note?: string // "joining…", "pending"
  badge?: number // unread messages
  onPress?: () => void
  onLongPress?: () => void // the menu (the desktop's right click)
}

const Row = ({ avatar, name, sub, note, badge, onPress, onLongPress }: RowProps) => (
  <Pressable
    style={({ pressed }) => [styles.item, pressed && (!!onPress || !!onLongPress) && styles.itemPressed]}
    onPress={onPress}
    onLongPress={onLongPress}
    disabled={!onPress && !onLongPress}
  >
    {avatar}
    <View style={styles.itemText}>
      <Text style={[styles.itemName, !onPress && styles.muted, !!badge && styles.strong]} numberOfLines={1}>
        {name}
      </Text>
      {!!sub && (
        <Text style={styles.itemSub} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
    {!!note && <Text style={styles.note}>{note}</Text>}
    {/* Red unread badge, Discord-style (capped at 99+), as on the desktop */}
    {!!badge && (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
      </View>
    )}
  </Pressable>
)

//& Screen
export const HomeScreen = () => {
  const { t } = useTranslation()
  const state = useCore((s) => s.state)
  const bootError = useCore((s) => s.error)
  const unread = useCore((s) => s.unread)
  const [adding, setAdding] = useState<'friend' | 'room' | null>(null)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<SheetSpec | null>(null)

  if (bootError) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.error}>{bootError}</Text>
      </SafeAreaView>
    )
  }

  if (!state) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted}>{t('home.connecting')}</Text>
      </SafeAreaView>
    )
  }

  const { me, friends, rooms } = state
  if (!me.named) return <WelcomeScreen me={me} /> // first launch: choose a name first, as on the desktop
  const requests = friends.filter((f: Friend) => f.status === 'incoming')
  const contacts = friends.filter((f: Friend) => f.status !== 'incoming')
  const invites = rooms.filter((r: Room) => r.status === 'invited')
  const myRooms = rooms.filter((r: Room) => r.status !== 'invited')

  // Runs a core call and shows its error (invalid code, own code…); rethrows so a form keeps its text
  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  const toggle = (form: 'friend' | 'room') => {
    setError('')
    setAdding((current) => (current === form ? null : form))
  }

  const createRoom = (name: string) =>
    run(async () => {
      const key = await call<string>('createRoom', name)
      setAdding(null)
      openRoom(key) // created then opened, as on the desktop
    })

  const addFriend = (code: string) =>
    run(async () => {
      await call('addFriend', code)
      setAdding(null)
    })

  const ignore = (p: Promise<unknown>) => void p.catch(() => {}) // the error is already shown

  // Long press on a friend: message / remove (a request I sent: cancel it), as the desktop's right click
  const friendMenu = (f: Friend) =>
    setSheet({
      title: f.name,
      actions:
        f.status === 'accepted'
          ? [
              { label: t('menu.openChat'), onPress: () => openChat(f.key) },
              {
                label: t('report.action'),
                danger: true,
                confirm: t('report.ask', { name: f.name }),
                onPress: () => report({ key: f.key, name: f.name, where: t('report.dm'), friend: true })
              },
              {
                label: t('menu.removeFriend'),
                danger: true,
                confirm: t('mobile.removeFriendAsk', { name: f.name }),
                onPress: () => ignore(run(() => call('removeFriend', f.key)))
              }
            ]
          : [
              {
                label: t('mobile.cancelRequest'),
                danger: true,
                confirm: t('mobile.cancelRequestAsk', { name: f.name }),
                onPress: () => ignore(run(() => call('removeFriend', f.key)))
              }
            ]
    })

  // Long press on a room: open, its settings (members screen), leave it, or delete it (its creator)
  const roomMenu = (r: Room) =>
    setSheet({
      title: r.name,
      actions: [
        { label: t('menu.openRoom'), onPress: () => openRoom(r.key) },
        { label: t('roomSettings.title'), onPress: () => router.push({ pathname: '/room/[key]/members', params: { key: r.key } }) },
        r.isOwner
          ? {
              label: t('roomSettings.deleteRoom'),
              danger: true,
              confirm: t('roomSettings.deleteRoomAsk', { name: r.name }),
              onPress: () => ignore(run(() => call('deleteRoom', r.key)))
            }
          : {
              label: t('roomSettings.leaveRoom'),
              danger: true,
              confirm: t('roomSettings.leaveAsk', { name: r.name }),
              onPress: () => ignore(run(() => call('leaveRoom', r.key)))
            }
      ]
    })

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/*& Profile */}
      <View style={styles.profile}>
        {/* My avatar: tap to choose a picture (as a click on the desktop) */}
        <Pressable
          onPress={() => ignore(run(changeMyAvatar))}
          accessibilityLabel={t('settings.photoHintMobile')}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Avatar src={me.avatar} name={me.name} size={56} cutout={colors.bgDeep} />
        </Pressable>
        <View style={styles.identity}>
          <NameEditor name={me.name} />
          {/* The invite link moved to the settings (gear), 2026-11-23 */}
          <StatusEditor status={me.customStatus} />
        </View>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityLabel={t('home.settings')}
          hitSlop={6}
          style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
        >
          <Icon name="settings" size={26} color={colors.textMuted} />
        </Pressable>
      </View>
      <AccentLine />

      <ScrollView contentContainerStyle={styles.lists} keyboardShouldPersistTaps="handled">
        <UpdateBanner />
        {!!error && <Text style={styles.error}>{error}</Text>}

        {/*& Friend requests and room invitations */}
        {(requests.length > 0 || invites.length > 0) && (
          <View style={styles.section}>
            <SectionTitle label={t('home.waiting')} />
            {requests.map((f) => (
              <View key={f.key} style={styles.request}>
                <Text style={styles.requestText}>
                  <Trans i18nKey="home.wantsToAdd" values={{ name: f.name }} components={{ strong: <Text style={styles.strong} /> }} />
                </Text>
                <View style={styles.buttons}>
                  <Button label={t('home.accept')} kind="primary" onPress={() => ignore(run(() => call('acceptRequest', f.key)))} />
                  <Button label={t('home.decline')} kind="danger" onPress={() => ignore(run(() => call('declineRequest', f.key)))} />
                </View>
              </View>
            ))}
            {invites.map((r) => (
              <View key={r.key} style={styles.request}>
                <Text style={styles.requestText}>
                  <Trans
                    i18nKey="home.invitesYou"
                    values={{ who: r.invitedBy, room: r.name }}
                    components={{ strong: <Text style={styles.strong} /> }}
                  />
                </Text>
                <View style={styles.buttons}>
                  <Button
                    label={t('home.join')}
                    kind="primary"
                    onPress={() => ignore(run(async () => {
                      await call('acceptRoomInvite', r.key)
                      openRoom(r.key)
                    }))}
                  />
                  <Button label={t('home.decline')} kind="danger" onPress={() => ignore(run(() => call('declineRoomInvite', r.key)))} />
                </View>
              </View>
            ))}
          </View>
        )}

        {/*& Rooms */}
        <View style={styles.section}>
          <SectionTitle
            label={t('home.rooms')}
            open={adding === 'room'}
            onToggle={() => toggle('room')}
            addLabel={t('home.createRoom')}
          />
          {adding === 'room' && (
            <InlineForm placeholder={t('home.roomName')} submitLabel={t('home.create')} onSubmit={createRoom} />
          )}
          {myRooms.length === 0 && adding !== 'room' && <Text style={styles.empty}>{t('home.noRooms')}</Text>}
          {myRooms.map((r) => (
            <Row
              key={r.key}
              avatar={<Avatar src={r.avatar} name={r.name} size={36} />}
              name={r.name}
              note={r.status === 'joining' ? t('home.joining') : undefined}
              badge={unread[r.key]}
              onPress={() => openRoom(r.key)}
              onLongPress={() => roomMenu(r)}
            />
          ))}
        </View>

        {/*& Friends */}
        <View style={styles.section}>
          <SectionTitle
            label={t('home.friends')}
            open={adding === 'friend'}
            onToggle={() => toggle('friend')}
            addLabel={t('home.addFriend')}
          />
          {adding === 'friend' && (
            <InlineForm placeholder={t('home.friendCode')} submitLabel={t('home.sendRequest')} onSubmit={addFriend} code />
          )}
          {contacts.length === 0 && adding !== 'friend' && <Text style={styles.empty}>{t('home.noFriends')}</Text>}
          {contacts.map((f) => (
            <Row
              key={f.key}
              avatar={<Avatar src={f.avatar} name={f.name} size={36} status={f.online ? 'online' : 'offline'} />}
              name={f.name}
              sub={f.customStatus}
              note={f.status === 'outgoing' ? t('home.pending') : undefined}
              badge={unread[f.key]}
              // A request I sent is not a conversation yet
              onPress={f.status === 'accepted' ? () => openChat(f.key) : undefined}
              onLongPress={() => friendMenu(f)}
            />
          ))}
        </View>
      </ScrollView>
      <ActionSheet spec={sheet} onClose={() => setSheet(null)} />
    </SafeAreaView>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space * 2, padding: space * 3 },
  pressed: { opacity: 0.6 },
  muted: { color: colors.textMuted },
  strong: { fontWeight: 'bold', color: colors.text },
  error: { color: colors.danger, paddingHorizontal: space * 2, paddingTop: space },
  update: {
    margin: space * 2,
    marginBottom: 0,
    padding: space * 1.5,
    gap: space,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius,
    backgroundColor: colors.bgDeep
  },

  //& Profile
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space * 1.5,
    padding: space * 2,
    backgroundColor: colors.bgDeep
  },
  identity: { flex: 1, minWidth: 0, gap: space / 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space },
  name: { flexShrink: 1, color: colors.text, fontSize: 19, fontWeight: '600' },
  nameEditing: {
    backgroundColor: colors.bg,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius,
    paddingHorizontal: space,
    paddingVertical: 2
  },
  key: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 13 },
  status: { color: colors.textMuted, fontSize: 14 },
  gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  //& Lists
  lists: { paddingVertical: space, paddingBottom: space * 4 },
  section: { paddingHorizontal: space, paddingVertical: space / 2 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space,
    paddingVertical: space
  },
  label: {
    flex: 1,
    color: colors.text, // brighter than the desktop (textDim): easier to spot on a phone
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase'
  },
  // "+": a real button on mobile (the desktop has a bare "+" that lights up on hover)
  add: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: colors.bgSoft
  },
  addOpen: { backgroundColor: colors.accent },
  empty: { color: colors.textMuted, fontSize: 14, paddingHorizontal: space, paddingVertical: space / 2 },

  form: { gap: space, paddingHorizontal: space, paddingBottom: space },
  input: {
    backgroundColor: colors.bgDeep,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    color: colors.text,
    paddingHorizontal: space * 1.5,
    paddingVertical: space
  },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space * 1.5,
    paddingHorizontal: space,
    paddingVertical: space,
    borderRadius: radius
  },
  itemPressed: { backgroundColor: colors.bgSoft },
  itemText: { flex: 1, minWidth: 0 },
  itemName: { color: colors.text, fontSize: 16 },
  itemSub: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  request: {
    gap: space,
    marginHorizontal: space,
    marginBottom: space,
    padding: space * 1.5,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: colors.bgSoft
  },
  requestText: { color: colors.text, fontSize: 15 },
  buttons: { flexDirection: 'row', gap: space }
})
