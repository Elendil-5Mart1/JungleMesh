//* Conversation with a friend (step 2: text only)
// Mobile counterpart of src/renderer/src/views/ChatView.tsx. The list and the input are
// shared with the room screen (components/MessageList, components/Composer).
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router/stack'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, Friend } from '../../../src/shared/types'
import { call } from '../bridge'
import { sendAnyFile, sendPhoto } from '../files'
import { report } from '../report'
import { Composer } from '../components/Composer'
import { MessageList } from '../components/MessageList'
import { useCore } from '../store'
import { useOnScreen } from '../useOnScreen'
import { colors, space } from '../theme'

const NO_MESSAGES: ChatMessage[] = [] // stable empty list (a new [] would re-render on every store change)

//& Screen
export const ChatScreen = ({ friendKey }: { friendKey: string }) => {
  const { t } = useTranslation()
  const me = useCore((s) => s.state?.me)
  const friend = useCore((s) => s.state?.friends.find((f: Friend) => f.key === friendKey))
  const messages = useCore((s) => s.messages[friendKey] ?? NO_MESSAGES)
  const loadHistory = useCore((s) => s.loadHistory)
  const headerHeight = useHeaderHeight() // the screen starts below the header: the keyboard maths need it

  useEffect(() => {
    void loadHistory(friendKey)
  }, [friendKey, loadHistory])
  useOnScreen(friendKey) // messages read as they arrive, unread counter cleared

  const name = friend?.name ?? friendKey.slice(0, 8)
  const nameOf = (key: string) => (key === me?.publicKey ? me.name : name)

  return (
    // keyboard-controller's version behaves the same on Android and iOS: the bottom padding
    // grows with the keyboard, so the list shrinks and the composer stays right above it
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => <View style={[styles.dot, { backgroundColor: friend?.online ? colors.accent : colors.textDim }]} />
        }}
      />

      <MessageList
        convKey={friendKey}
        messages={messages}
        myKey={me?.publicKey}
        nameOf={nameOf}
        onReport={(msg) => void report({ key: friendKey, name, where: t('report.dm'), friend: true, msg })}
      />

      {!friend?.online && <Text style={styles.notice}>{t('chat.offline', { name })}</Text>}

      <Composer
        placeholder={t('chat.sendTo', { name })}
        onSend={(text) => call('send', friendKey, text)}
        onAttach={(kind) => (kind === 'photo' ? sendPhoto(friendKey) : sendAnyFile(friendKey))}
      />
    </KeyboardAvoidingView>
  )
}

//& Styles
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  notice: { color: colors.textMuted, fontSize: 12, paddingHorizontal: space * 1.5, paddingBottom: space / 2 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: space }
})
