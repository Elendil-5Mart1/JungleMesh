//* Identity backup: one passphrase-encrypted file holding what is needed to get "me" back
// The Corestore master key derives the identity AND all my logs, so keeping that single secret (plus the
// small contacts / rooms / profile lists) is enough: friends re-send what they replicated of my messages.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../shared/i18n'

export const MIN_PASSPHRASE = 8
const MAX_FILE = 5_000_000 // per saved file, sanity limit on import
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

export interface BackupData {
  primaryKey: string // Corestore master key, hex
  files: Record<string, string> // file name → JSON text
}

//& Encryption: scrypt (slows down guessing) + AES-256-GCM (detects a wrong passphrase or a modified file)
const kdf = (passphrase: string, salt: Buffer): Buffer =>
  scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })

export const encryptBackup = (data: BackupData, passphrase: string): string => {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kdf(passphrase, salt), iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return JSON.stringify({
    app: MAGIC,
    v: 1,
    kdf: 'scrypt-N32768-r8-p1',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64')
  })
}

export const decryptBackup = (text: string, passphrase: string): BackupData => {
  let box: Record<string, unknown>
  try {
    box = JSON.parse(text)
  } catch {
    throw new Error(t('backup.invalidFile'))
  }
  if (box.app !== MAGIC || box.v !== 1 || [box.salt, box.iv, box.tag, box.data].some((v) => typeof v !== 'string')) {
    throw new Error(t('backup.invalidFile'))
  }
  let plain: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', kdf(passphrase, Buffer.from(box.salt as string, 'base64')), Buffer.from(box.iv as string, 'base64'))
    decipher.setAuthTag(Buffer.from(box.tag as string, 'base64'))
    plain = Buffer.concat([decipher.update(Buffer.from(box.data as string, 'base64')), decipher.final()]).toString('utf8')
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
