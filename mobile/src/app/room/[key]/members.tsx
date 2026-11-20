//* Route "/room/<room key>/members": members of a room and inviting friends
import { useLocalSearchParams } from 'expo-router'
import { MembersScreen } from '../../../screens/MembersScreen'

export const MembersRoute = () => {
  const { key } = useLocalSearchParams<{ key: string }>()
  return <MembersScreen roomKey={key} />
}

export default MembersRoute
