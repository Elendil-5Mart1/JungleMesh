//* Image chosen by the user → square 128×128 avatar in WebP (data URL of a few KB)
// Everything happens in the window with a <canvas>: no library, no server.

import { t } from '../../../shared/i18n'

const SIZE = 128

export const fileToAvatar = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) throw new Error(t('avatar.notImage'))

  // createImageBitmap decodes the image (PNG, JPEG, WebP, GIF → 1st frame) without going through <img>
  const bitmap = await createImageBitmap(file)

  // "Cover" crop: we keep the largest centered square
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE)
  bitmap.close()

  return canvas.toDataURL('image/webp', 0.85)
}
