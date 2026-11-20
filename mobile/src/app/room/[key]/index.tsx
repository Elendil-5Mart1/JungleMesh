//* Route "/room/<room key>": a room
import { useLocalSearchParams } from 'expo-router'
import { RoomScreen } from '../../../screens/RoomScreen'

export const RoomRoute = () => {
  const { key } = useLocalSearchParams<{ key: string }>()
  return <RoomScreen roomKey={key} />
}

export default RoomRoute
