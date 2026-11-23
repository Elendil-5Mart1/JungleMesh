//* Reporting a message or a person (required by Google Play for apps with user content)
// JungleMesh has no server: nobody but the people in a conversation can read it, the developer included.
// A report therefore prepares an e-mail to the project's contact address (the one of SECURITY.md) with
// what the user chooses to send: who, where, and the reported message. Nothing leaves the phone until
// the user sends that e-mail from their own mail app. Blocking is then offered (removing a friend blocks them).
import { Alert, Linking } from 'react-native'
import Constants from 'expo-constants'
import { i18n } from '../../src/shared/i18n'
import type { ChatMessage } from '../../src/shared/types'
import { call } from './bridge'

export const REPORT_EMAIL = 'neuralkink@proton.me'

interface ReportTarget {
  key: string // public key of the reported person
  name: string
  where: string // "DM" or "#room-name"
  friend: boolean // a friend can be blocked right after (removeFriend blocks)
  msg?: ChatMessage // the reported message, if any
}

const mailBody = ({ key, name, where, msg }: ReportTarget): string => {
  const t = i18n.t.bind(i18n)
  const lines = [
    t('report.bodyIntro'),
    '',
    `${t('report.person')}: ${name}`,
    `${t('report.key')}: ${key}`,
    `${t('report.where')}: ${where}`
  ]
  if (msg) {
    lines.push(`${t('report.date')}: ${new Date(msg.ts).toISOString()}`, `${t('report.messageId')}: ${msg.id}`, '')
    if (msg.text) lines.push(...msg.text.split('\n').map((line) => `> ${line}`))
    if (msg.file) lines.push(`> [${msg.file.name}]`)
  }
  lines.push('', `${t('report.reason')}:`, '', '', `JungleMesh Android ${Constants.expoConfig?.version ?? '?'}`)
  return lines.join('\n')
}

// Opens the mail app, then offers to block the person (friends only: a room member cannot be blocked alone)
export const report = async (target: ReportTarget): Promise<void> => {
  const t = i18n.t.bind(i18n)
  const subject = t('report.subject', { name: target.name })
  const url = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody(target))}`
  try {
    await Linking.openURL(url)
  } catch {
    // No mail app: the address is shown so the user can write from elsewhere
    Alert.alert(t('report.noMailApp'), REPORT_EMAIL)
  }
  if (!target.friend) return
  Alert.alert(t('report.blockAsk', { name: target.name }), t('report.blockHint'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('report.block'), style: 'destructive', onPress: () => void call('removeFriend', target.key).catch(() => {}) }
  ])
}
