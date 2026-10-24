//* Updates from GitHub releases (electron-updater): always asks before downloading or installing
// Only in the installed app, and only if the user left the option on (Settings › Privacy).
// Nothing is downloaded without a click; the check itself contacts GitHub, so GitHub sees the IP.
import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { t } from '../shared/i18n'

const FIRST_CHECK_MS = 30_000 // let the app settle first
const EVERY_MS = 24 * 60 * 60 * 1000 // the app stays in the tray for days: once a day is enough

export const startUpdater = (isEnabled: () => boolean): void => {
  if (!app.isPackaged) return // in dev there is nothing to update
  // macOS only installs updates of an app signed by an Apple developer account: ours is not (test builds)
  if (process.platform === 'darwin') return

  autoUpdater.autoDownload = false // ask first
  autoUpdater.autoInstallOnAppQuit = false // and install only when the user agrees
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null

  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: [t('update.download'), t('update.later')],
      defaultId: 0,
      cancelId: 1,
      message: t('update.available', { version: info.version }),
      detail: t('update.detail')
    })
    if (response === 0) void autoUpdater.downloadUpdate().catch(() => {})
  })

  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: [t('update.restart'), t('update.later')],
      defaultId: 0,
      cancelId: 1,
      message: t('update.ready')
    })
    if (response === 0) autoUpdater.quitAndInstall(true, true) // silent: the wizard already ran at the first install
  })

  const check = (): void => {
    if (isEnabled()) autoUpdater.checkForUpdates().catch(() => {}) // offline, private repository, rate limit…: stay silent
  }
  setTimeout(check, FIRST_CHECK_MS).unref()
  setInterval(check, EVERY_MS).unref()
}
