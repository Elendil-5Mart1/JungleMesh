//* Route "/add/<invite code>": opened by a junglemesh://add/<code> link (shared by Settings › Share)
import { useLocalSearchParams } from 'expo-router'
import { AddFriendScreen } from '../../screens/AddFriendScreen'

export const AddFriendRoute = () => {
  const { code } = useLocalSearchParams<{ code: string }>()
  return <AddFriendScreen code={code} />
}

export default AddFriendRoute
