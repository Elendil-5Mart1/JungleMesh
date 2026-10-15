//* Icon in the notification area (next to the clock)
// The app stays connected to the P2P network even when all its windows are closed:
// we receive messages and notifications, and reopen everything with one click.
import { app, Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import type { CoreState, UnreadCounts } from '../shared/types'
import { trayIcon } from './icons'
import { t } from '../shared/i18n'

interface TrayDeps {
  getState: () => CoreState
  getUnread: () => UnreadCounts
  openHome: () => void
  openChat: (key: string) => void
  openRoom: (key: string) => void
  openSettings: () => void
}

export const createTray = (deps: TrayDeps) => {
  const tray = new Tray(trayIcon(false))
  tray.on('click', deps.openHome) // left click: the friends list; right click: the menu

  // Rebuilds icon, tooltip and menu (called on every friends or unread change)
  const refresh = (): void => {
    const unread = deps.getUnread()
    const total = Object.values(unread).reduce((a, b) => a + b, 0)
    tray.setImage(trayIcon(total > 0))
    tray.setToolTip(total > 0 ? `JungleMesh · ${t('tray.unread', { count: total })}` : 'JungleMesh')

    // Shortcuts to each conversation: ● online, ○ offline, (n) unread
    const friends = deps.getState().friends.filter((f) => f.status === 'accepted')
    const chats: MenuItemConstructorOptions[] = friends.length
      ? friends.map((f) => ({
          label: `${f.online ? '●' : '○'}  ${f.name}${unread[f.key] ? `  (${unread[f.key]})` : ''}`,
          click: () => deps.openChat(f.key)
        }))
      : [{ label: t('tray.noFriends'), enabled: false }]

    // Then the rooms joined: # name (n)
    const rooms: MenuItemConstructorOptions[] = deps
      .getState()
      .rooms.filter((r) => r.status !== 'invited')
      .map((r) => ({
        label: `#  ${r.name}${unread[r.key] ? `  (${unread[r.key]})` : ''}`,
        click: () => deps.openRoom(r.key)
      }))

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.open'), click: deps.openHome },
        { type: 'separator' },
        ...chats,
        ...(rooms.length ? [{ type: 'separator' } as const, ...rooms] : []),
        { type: 'separator' },
        { label: t('home.settings'), click: deps.openSettings },
        { label: t('tray.quit'), click: () => app.quit() } // the only real way to stop the P2P
      ])
    )
  }

  refresh()
  return { refresh }
}
