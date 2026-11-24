//* Identity backup: one passphrase-encrypted file holding what is needed to get "me" back
// The Corestore master key derives the identity AND all my logs, so keeping that single secret (plus the
// small contacts / rooms / profile lists) is enough: friends re-send what they replicated of my messages.
// Shared with the phone's Bare worker (mobile/worker/core.ts): b4a rather than Buffer, and the scrypt
// function is given by the caller (Bare has none: the phone uses @noble/hashes, same result).
import b4a from 'b4a'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../shared/i18n'

export const MIN_PASSPHRASE = 8
const MAX_FILE = 5_000_000 // per saved file, sanity limit on import
export const MAX_BACKUP = 20_000_000 // whole .jmbackup file, refused before decrypting

export const checkPassphrase = (p: unknown): string => {
  if (typeof p !== 'string' || p.length < MIN_PASSPHRASE) throw new Error(t('backup.tooShort', { min: MIN_PASSPHRASE }))
  return p
}
const MAGIC = 'junglemesh-backup'

// What the backup carries (never the Corestore itself: heavy, and rebuilt by replication)
const BACKUP_FILES = ['profile.json', 'contacts.json', 'rooms.json'] as const

// Everything that makes up the identity on disk (also used by "new identity" / "erase all")
export const IDENTITY_FILES = [
  'corestore',
  'contacts.json',
  'rooms.json',
  'avatars.json',
  'unread.json',
  'session.json',
  'identity.json',
  'restore.key'
]

//& Wipe ("new identity" / "erase everything"), while the P2P core is stopped
// settingsFiles = this platform's own settings: kept by "new identity" (with the name and picture),
// erased by "erase everything". Never anything else in the folder (test profiles, Chromium's files).
export const wipeData = (dir: string, mode: 'identity' | 'all', settingsFiles: string[]): void => {
  const erase = new Set([...IDENTITY_FILES, ...(mode === 'all' ? ['profile.json', ...settingsFiles] : [])])
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!erase.has(name)) continue
    try {
      rmSync(join(dir, name), { recursive: true, force: true })
    } catch (err) {
      console.error('reset: could not remove', name, err)
    }
  }
}

export interface BackupData {
  primaryKey: string // Corestore master key, hex
  files: Record<string, string> // file name → JSON text
}

//& Encryption: scrypt (slows down guessing) + AES-256-GCM (detects a wrong passphrase or a modified file)
// The scrypt parameters are part of the file format (v1): never change them without a v2.
export const SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const
export type Scrypt = (password: Uint8Array, salt: Uint8Array) => Promise<Uint8Array>

// The passphrase as UTF-8 bytes, NFKC-normalized ("é" typed as one or two characters gives the same key)
const passBytes = (passphrase: string): Uint8Array => b4a.from(passphrase.normalize('NFKC'), 'utf8')

// GCM: Node returns the data in update(), Bare only in final(): concatenating both works with either
export const encryptBackup = async (data: BackupData, passphrase: string, scrypt: Scrypt): Promise<string> => {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await scrypt(passBytes(passphrase), salt), iv)
  const enc = b4a.concat([cipher.update(b4a.from(JSON.stringify(data), 'utf8')), cipher.final()])
  return JSON.stringify({
    app: MAGIC,
    v: 1,
    kdf: 'scrypt-N32768-r8-p1',
    salt: b4a.toString(salt, 'base64'),
    iv: b4a.toString(iv, 'base64'),
    tag: b4a.toString(cipher.getAuthTag(), 'base64'),
    data: b4a.toString(enc, 'base64')
  })
}

export const decryptBackup = async (text: string, passphrase: string, scrypt: Scrypt): Promise<BackupData> => {
  let box: Record<string, unknown>
  try {
    box = JSON.parse(text)
  } catch {
    throw new Error(t('backup.invalidFile'))
  }
  if (box.app !== MAGIC || box.v !== 1 || [box.salt, box.iv, box.tag, box.data].some((v) => typeof v !== 'string')) {
    throw new Error(t('backup.invalidFile'))
  }
  const key = await scrypt(passBytes(passphrase), b4a.from(box.salt as string, 'base64'))
  let plain: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, b4a.from(box.iv as string, 'base64'))
    decipher.setAuthTag(b4a.from(box.tag as string, 'base64'))
    plain = b4a.toString(b4a.concat([decipher.update(b4a.from(box.data as string, 'base64')), decipher.final()]), 'utf8')
  } catch {
    throw new Error(t('backup.wrongPass')) // GCM fails on a wrong passphrase as well as on a modified file
  }
  return cleanBackup(JSON.parse(plain))
}

// We never trust a file, even a decrypted one: only known names, JSON content, bounded size
const cleanBackup = (raw: any): BackupData => {
  if (typeof raw?.primaryKey !== 'string' || !/^[0-9a-f]{64}$/.test(raw.primaryKey) || typeof raw.files !== 'object') {
    throw new Error(t('backup.invalidFile'))
  }
  const files: Record<string, string> = {}
  for (const name of BACKUP_FILES) {
    const text = raw.files?.[name]
    if (typeof text !== 'string') continue
    if (text.length > MAX_FILE) throw new Error(t('backup.invalidFile'))
    try {
      JSON.parse(text)
    } catch {
      throw new Error(t('backup.invalidFile'))
    }
    files[name] = text
  }
  return { primaryKey: raw.primaryKey, files }
}

//& Export: the key comes from the running core, the lists from the data folder
export const collectBackup = (dir: string, primaryKey: string): BackupData => {
  const files: Record<string, string> = {}
  for (const name of BACKUP_FILES) {
    const path = join(dir, name)
    if (existsSync(path)) files[name] = readFileSync(path, 'utf8')
  }
  return { primaryKey, files }
}

//& Import, step 1 (while the app runs): leave the data to restore in restore.json, then the app relaunches
export const stageRestore = (dir: string, data: BackupData): void =>
  writeFileSync(join(dir, 'restore.json'), JSON.stringify(data), { mode: 0o600 })

//& Import, step 2 (at startup, before the P2P core opens anything): swap the identity files
// The master key goes into restore.key; P2PCore.start() consumes it to create the Corestore with that key.
export const applyRestore = (dir: string): void => {
  const staged = join(dir, 'restore.json')
  if (!existsSync(staged)) return
  try {
    const data = cleanBackup(JSON.parse(readFileSync(staged, 'utf8')))
    for (const name of readdirSync(dir)) {
      if (IDENTITY_FILES.includes(name) || name === 'profile.json') rmSync(join(dir, name), { recursive: true, force: true })
    }
    for (const [name, text] of Object.entries(data.files)) writeFileSync(join(dir, name), text)
    writeFileSync(join(dir, 'restore.key'), data.primaryKey, { mode: 0o600 })
  } catch (err) {
    console.error('restore: failed', err)
  } finally {
    rmSync(staged, { force: true })
  }
}
