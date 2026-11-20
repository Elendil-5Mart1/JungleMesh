//* Route "/chat/<friend key>": a conversation with a friend
import { useLocalSearchParams } from 'expo-router'
import { ChatScreen } from '../../screens/ChatScreen'

export const ChatRoute = () => {
  const { key } = useLocalSearchParams<{ key: string }>()
  return <ChatScreen friendKey={key} />
}

export default ChatRoute
