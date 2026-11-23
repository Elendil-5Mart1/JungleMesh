//* Choosing my profile picture on the phone (the desktop does it in components/Avatar.tsx with a canvas)
// 1. The system photo picker (no storage permission needed), with Android's square crop screen.
// 2. Center square → 128×128 → WebP, sent as a data URL: the same format as the desktop, which the core
//    checks (cleanAvatar: ≤ 512 px, ≤ 100 KB) and announces to every friend.
// The camera is not offered: its permission is blocked in app.json (one permission less to justify).
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { call } from './bridge'

const SIZE = 128

//& The chosen picture as a data URL, or null if the user backed out
export const pickAvatar = async (): Promise<string | null> => {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    shape: 'oval', // the crop circle shows what the round avatar will look like
    quality: 1
  })
  if (picked.canceled || !picked.assets[0]) return null
  const { uri, width, height } = picked.assets[0]

  // The crop screen already gives a square, but not every gallery app respects it: cut the center square
  const side = Math.min(width, height)
  const image = await ImageManipulator.manipulate(uri)
    .crop({ originX: (width - side) / 2, originY: (height - side) / 2, width: side, height: side })
    .resize({ width: SIZE, height: SIZE })
    .renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.WEBP, compress: 0.85, base64: true })
  if (!saved.base64) throw new Error('image conversion failed')
  return `data:image/webp;base64,${saved.base64}`
}

//& Pick, then announce it (the new picture comes back through the 'state' event)
export const changeMyAvatar = async (): Promise<void> => {
  const avatar = await pickAvatar()
  if (avatar) await call('setAvatar', avatar)
}
