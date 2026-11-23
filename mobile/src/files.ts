//* Files and images on the phone: picking and sending, saving a received file
// The P2P core runs in the Bare worker, which reads and writes plain paths only (bare-fs). Android hands
// out the user's files as content:// URIs (Storage Access Framework): the app's cache is the meeting point.
// - Sending: the picked file is copied into the cache, the worker copies it block by block into its log
//   (sendFilePath, any size, as on the desktop), then the cache copy is deleted.
// - Saving: the worker writes the file into the cache (saveFile), then it is copied into the download folder
//   the user chose once (Android keeps that permission), and the cache copy is deleted. As on the desktop,
//   a receipt then lets the sender free their copy, and the app's own copy is freed.
import { Directory, File, Paths } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import type { ChatMessage } from '../../src/shared/types'
import { call } from './bridge'
import { useCore } from './store'

type SharedFile = NonNullable<ChatMessage['file']>

// Lifetime of shared images when the room's creator chose none (and in DMs): the core's own default.
// Not a phone setting yet (the desktop has Settings › Privacy › Shared images).
export const DEFAULT_IMAGE_TTL_HOURS = 72

const PHOTO_MAX_SIDE = 2048 // a 12 MP phone photo (4000 px, 5 MB) becomes ~400 KB, plenty for a chat

// file:///data/user/0/… → /data/user/0/… (the worker wants a plain path)
const plainPath = (file: File): string => decodeURIComponent(new URL(file.uri).pathname)

// A folder of the cache, created on first use
const cacheDir = (name: string): Directory => {
  const dir = new Directory(Paths.cache, name)
  dir.create({ idempotent: true, intermediates: true })
  return dir
}

// The user backed out of a system picker (the native module throws for the folder picker)
const isCancel = (err: unknown): boolean => err instanceof Error && /cancel/i.test(err.message)

//& Sending
// A file the worker can read → into the conversation, then the temporary copy goes
const sendFromCache = async (convId: string, name: string, file: File, channel?: string): Promise<void> => {
  try {
    await call('sendFilePath', convId, name, plainPath(file), channel, '')
  } finally {
    try {
      file.delete()
    } catch {
      // already gone: nothing to clean
    }
  }
}

// A photo from the gallery: resized and re-encoded in JPEG, which also drops its EXIF data
// (GPS position, phone model). An animated GIF is sent as is (re-encoding would freeze it).
export const sendPhoto = async (convId: string, channel?: string): Promise<boolean> => {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
  const asset = picked.canceled ? null : picked.assets[0]
  if (!asset) return false
  const base = (asset.fileName ?? 'photo').replace(/\.[^.]+$/, '')

  if (asset.mimeType === 'image/gif') {
    const copy = new File(cacheDir('outgoing'), `${Date.now()}.gif`)
    await new File(asset.uri).copy(copy)
    await sendFromCache(convId, `${base}.gif`, copy, channel)
    return true
  }

  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(asset.width, asset.height))
  const context = ImageManipulator.manipulate(asset.uri)
  if (scale < 1) context.resize({ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) })
  const image = await context.renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })
  await sendFromCache(convId, `${base}.jpg`, new File(saved.uri), channel)
  return true
}

// Any file (document, sound, video…), any size: copied from the system picker into the cache first
export const sendAnyFile = async (convId: string, channel?: string): Promise<boolean> => {
  const picked = await File.pickFileAsync()
  if (picked.canceled) return false
  const name = picked.result.name || 'file'
  const copy = new File(cacheDir('outgoing'), `${Date.now()}-${name}`)
  await picked.result.copy(copy)
  await sendFromCache(convId, name, copy, channel)
  return true
}

//& Download folder (chosen once, kept in the phone's settings; Android keeps the permission)
export const chooseDownloadDir = async (): Promise<Directory | null> => {
  const current = useCore.getState().settings?.downloadDir || undefined
  try {
    const dir = await Directory.pickDirectoryAsync(current)
    await useCore.getState().saveSettings({ downloadDir: dir.uri })
    return dir
  } catch (err) {
    if (isCancel(err)) return null
    throw err
  }
}

// Readable name of a folder: content://…/tree/primary%3ADownload%2FJungleMesh → "Download/JungleMesh"
export const folderLabel = (uri: string): string => {
  const tree = decodeURIComponent(uri.split('/tree/')[1] ?? uri)
  return tree.replace(/^primary:/, '') || tree
}

// The saved folder, or a new choice if there is none yet
const downloadDir = async (): Promise<Directory | null> => {
  const uri = useCore.getState().settings?.downloadDir
  return uri ? new Directory(uri) : chooseDownloadDir()
}

// Copies a file of the cache into the download folder. The folder can have vanished, or its permission
// been revoked (app data cleared, folder deleted): the user is then asked for a new one, once.
const copyToDownloads = async (source: File, name: string, mime: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const dir = attempt === 0 ? await downloadDir() : await chooseDownloadDir()
    if (!dir) return false
    try {
      // createFile picks a free name ("photo (1).jpg") instead of overwriting
      const target = dir.createFile(name, mime)
      await source.copy(target, { overwrite: true })
      return true
    } catch (err) {
      if (attempt === 1) throw err
    }
  }
  return false
}

//& Saving a received (or my own) file. false = the user backed out of the folder choice
export const saveAttachment = async (convId: string, file: SharedFile): Promise<boolean> => {
  // The folder first (as the desktop's dialog): nothing is transferred if the user backs out
  if (!(await downloadDir())) return false
  const temp = new File(cacheDir('incoming'), `${file.core.slice(0, 16)}-${file.name}`)
  try {
    await call('saveFile', file.core, plainPath(temp)) // the transfer itself (progress: 'file-progress')
    if (!(await copyToDownloads(temp, file.name, file.mime))) return false
  } finally {
    try {
      temp.delete()
    } catch {
      // the transfer failed before creating it
    }
  }
  // Receipt for the sender, then the app's own copy is freed (the user's copy is the one that counts)
  void call('confirmReceived', convId, file.core).catch(() => {})
  void call('releaseFile', file.core).catch(() => {})
  return true
}

//& Displaying an image of the chat (checked by the core: real image, size limits)
export const imageDataUrl = (coreKey: string): Promise<string> => call<string>('imageDataUrl', coreKey)

// Readable size, as on the desktop's cards
export const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : bytes < 1024 ** 3
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${(bytes / 1024 ** 3).toFixed(2)} GB`
