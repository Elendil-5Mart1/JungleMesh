//* Preload: exposes a limited API to React (window.api), and nothing else from Node
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppSettings, ChatApi, ChatMessage, CoreState, UnreadCounts, VoiceSignal } from '../shared/types'

const api: ChatApi = {
  getState: () => ipcRenderer.invoke('core:getState'),
  setName: (name) => ipcRenderer.invoke('core:setName', name),
  setAvatar: (avatar) => ipcRenderer.invoke('core:setAvatar', avatar),
  addFriend: (code, nickname) => ipcRenderer.invoke('friends:add', code, nickname),
  acceptRequest: (key) => ipcRenderer.invoke('friends:accept', key),
  declineRequest: (key) => ipcRenderer.invoke('friends:decline', key),
  getHistory: (key) => ipcRenderer.invoke('chat:history', key),
  send: (key, text, channel) => ipcRenderer.invoke('chat:send', key, text, channel),
  createRoom: (name) => ipcRenderer.invoke('rooms:create', name),
  setRoomAvatar: (room, avatar) => ipcRenderer.invoke('rooms:setAvatar', room, avatar),
  createChannel: (room, name, kind) => ipcRenderer.invoke('rooms:createChannel', room, name, kind),
  renameRoom: (room, name) => ipcRenderer.invoke('rooms:rename', room, name),
  renameChannel: (room, id, name) => ipcRenderer.invoke('rooms:renameChannel', room, id, name),
  deleteChannel: (room, id) => ipcRenderer.invoke('rooms:deleteChannel', room, id),
  kickFromRoom: (room, member) => ipcRenderer.invoke('rooms:kick', room, member),
  leaveRoom: (room) => ipcRenderer.invoke('rooms:leave', room),
  deleteRoom: (room) => ipcRenderer.invoke('rooms:delete', room),
  removeFriend: (key) => ipcRenderer.invoke('friends:remove', key),
  inviteToRoom: (room, friend) => ipcRenderer.invoke('rooms:invite', room, friend),
  acceptRoomInvite: (room) => ipcRenderer.invoke('rooms:accept', room),
  declineRoomInvite: (room) => ipcRenderer.invoke('rooms:decline', room),
  openChat: (key) => ipcRenderer.invoke('window:openChat', key),
  openRoom: (key) => ipcRenderer.invoke('window:openRoom', key),
  toggleChat: (key) => ipcRenderer.invoke('window:toggleChat', key),
  toggleRoom: (key) => ipcRenderer.invoke('window:toggleRoom', key),
  getVisibleWindows: () => ipcRenderer.invoke('windows:visible'),
  getUnread: () => ipcRenderer.invoke('unread:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openSettings: () => ipcRenderer.invoke('window:openSettings'),
  resetData: (mode) => ipcRenderer.invoke('data:reset', mode),
  exportBackup: (passphrase) => ipcRenderer.invoke('backup:export', passphrase),
  importBackup: (passphrase) => ipcRenderer.invoke('backup:import', passphrase),
  onSettings: (cb) => {
    const listener = (_e: IpcRendererEvent, settings: AppSettings): void => cb(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },

  // Subscriptions: return an unsubscribe function (handy in a useEffect)
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, state: CoreState): void => cb(state)
    ipcRenderer.on('core:state', listener)
    return () => ipcRenderer.removeListener('core:state', listener)
  },
  onMessage: (cb) => {
    const listener = (_e: IpcRendererEvent, key: string, msg: ChatMessage): void => cb(key, msg)
    ipcRenderer.on('chat:message', listener)
    return () => ipcRenderer.removeListener('chat:message', listener)
  },
  onVisibleWindows: (cb) => {
    const listener = (_e: IpcRendererEvent, ids: string[]): void => cb(ids)
    ipcRenderer.on('windows:visible', listener)
    return () => ipcRenderer.removeListener('windows:visible', listener)
  },
  onUnread: (cb) => {
    const listener = (_e: IpcRendererEvent, unread: UnreadCounts): void => cb(unread)
    ipcRenderer.on('unread:changed', listener)
    return () => ipcRenderer.removeListener('unread:changed', listener)
  },
  onNotifySound: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('notify:sound', listener)
    return () => ipcRenderer.removeListener('notify:sound', listener)
  },
  onNotifyRing: (cb) => {
    const listener = (_e: IpcRendererEvent, on: boolean): void => cb(on)
    ipcRenderer.on('notify:ring', listener)
    return () => ipcRenderer.removeListener('notify:ring', listener)
  },
  pickSound: (kind) => ipcRenderer.invoke('sound:pick', kind),
  resetSound: (kind) => ipcRenderer.invoke('sound:reset', kind),
  getSound: (kind) => ipcRenderer.invoke('sound:get', kind),
  callAccept: (key) => ipcRenderer.invoke('call:accept', key),
  callDecline: (key) => ipcRenderer.invoke('call:decline', key),
  callTakeAutoJoin: (key) => ipcRenderer.invoke('call:takeAutoJoin', key),
  onCallAutoJoin: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('call:autojoin', listener)
    return () => ipcRenderer.removeListener('call:autojoin', listener)
  },
  onCallDeclined: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('call:declined', listener)
    return () => ipcRenderer.removeListener('call:declined', listener)
  },
  getPendingInvite: () => ipcRenderer.invoke('invite:pending'),
  clearPendingInvite: () => ipcRenderer.invoke('invite:clear'),
  onInviteLink: (cb) => {
    const listener = (_e: IpcRendererEvent, code: string): void => cb(code)
    ipcRenderer.on('invite:link', listener)
    return () => ipcRenderer.removeListener('invite:link', listener)
  },
  windowMinimize: () => ipcRenderer.send('win:minimize'),
  windowClose: () => ipcRenderer.send('win:close'),
  windowResizeStart: () => ipcRenderer.send('win:resizeStart'),
  windowResize: (edge, dx, dy) => ipcRenderer.send('win:resize', edge, dx, dy),
  sendFileBytes: (convId, name, bytes, channel, text) => ipcRenderer.invoke('files:sendBytes', convId, name, bytes, channel, text),
  setRoomImageTtl: (room, hours) => ipcRenderer.invoke('rooms:setImageTtl', room, hours),
  onFileProgress: (cb) => {
    const listener = (_e: IpcRendererEvent, key: string, done: number, total: number): void => cb(key, done, total)
    ipcRenderer.on('files:progress', listener)
    return () => ipcRenderer.removeListener('files:progress', listener)
  },
  deleteMessage: (convId, id) => ipcRenderer.invoke('chat:delete', convId, id),
  onMessageDeleted: (cb) => {
    const listener = (_e: IpcRendererEvent, convId: string, id: string, author: string): void => cb(convId, id, author)
    ipcRenderer.on('chat:deleted', listener)
    return () => ipcRenderer.removeListener('chat:deleted', listener)
  },
  getImage: (coreKey) => ipcRenderer.invoke('files:image', coreKey),
  saveFile: (coreKey, name) => ipcRenderer.invoke('files:save', coreKey, name),
  voiceJoin: (room, chan) => ipcRenderer.invoke('voice:join', room, chan),
  voiceLeave: () => ipcRenderer.invoke('voice:leave'),
  voiceSignal: (to, room, chan, data) => ipcRenderer.invoke('voice:signal', to, room, chan, data),
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  screenChoose: (sourceId, audio) => ipcRenderer.invoke('screen:choose', sourceId, audio),
  onVoiceSignal: (cb) => {
    const listener = (_e: IpcRendererEvent, signal: VoiceSignal): void => cb(signal)
    ipcRenderer.on('voice:signal', listener)
    return () => ipcRenderer.removeListener('voice:signal', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
