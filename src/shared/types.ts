//* Types shared between the main process, the preload and the React windows
// A single place to describe the data: if we change a field, TypeScript
// flags all the places to adapt, on both sides of the IPC.

// Avatar = 128×128 image encoded as a "data URL" (data:image/webp;base64,…), or null
export type Avatar = string | null

export interface Me {
  publicKey: string // hex public key = the user's unique identifier
  inviteCode: string // the same key in base32, to share in order to be added
  name: string
  named: boolean // false until the user has chosen a display name (shows the welcome screen)
  avatar: Avatar
}

// accepted = friend · outgoing = request sent · incoming = request received
export type FriendStatus = 'accepted' | 'outgoing' | 'incoming'

export interface Friend {
  key: string
  name: string
  avatar: Avatar
  status: FriendStatus
  online: boolean
  callId: string // id of the voice "room" shared with this friend (1-to-1 call)
  call: string[] // keys of the people in our call right now (me included)
}

//& Rooms (the equivalent of a Discord server) and their channels
// invited = invitation received · joining = accepted, waiting to be signed up by the creator
// joined = member signed up in the room's registry
export type RoomStatus = 'invited' | 'joining' | 'joined'

export type ChannelKind = 'text' | 'voice'

export interface Channel {
  id: string // 'general' for the default text channel
  name: string
  kind: ChannelKind
}

export interface RoomMember {
  key: string
  name: string
  avatar: Avatar
  online: boolean
  isOwner: boolean
}

export interface Room {
  key: string // key of the creator's log = the room's identifier
  name: string
  avatar: Avatar
  imageTtl?: number // hours before shared images disappear, set by the creator (missing = each member's default)
  status: RoomStatus
  isOwner: boolean
  invitedBy: string // name of the person who invited (received rooms)
  members: RoomMember[]
  channels: Channel[]
  pendingInvites: string[] // keys of the invited friends not yet signed up (seen by the creator)
  voice: Record<string, string[]> // voice channel → keys of the people in it (me included)
}

export interface ChatMessage {
  id: string
  from: string // author's public key
  text: string // raw markdown, interpreted at display time
  ts: number
  channel?: string // channel of a room ('general' if missing)
  file?: { core: string; name: string; size: number; mime: string; image: boolean } // attachment (image or other file)
  system?: boolean // informational message ("X joined the room"), not written by a human
  call?: CallEvent // DM call event (system line, its text is built by the window with the author's name)
}

// conversation key (friend or room) → number of unread messages (missing = 0)
export type UnreadCounts = Record<string, number>

export interface CoreState {
  me: Me
  friends: Friend[]
  rooms: Room[]
}

// Call events written in the DM history (only "declined" for now)
export type CallEvent = 'declined'

// Blur behind the windows (Windows 11): none, Pearl (frosted glass + pearly sheen drawn in CSS), Acrylic (frosted glass)
export type WindowMaterial = 'none' | 'pearl' | 'acrylic'

// Sounds the user can replace with their own file
export type SoundKind = 'notif' | 'ring'

//& App settings (settings.json, specific to this device)
export interface AppSettings {
  notifications: boolean // Windows toasts for messages, requests and invitations
  flash: boolean // the home window flashes in the taskbar on a new message
  notifSound: boolean // short sound on a new message / request (muted conversations stay silent)
  ringtone: boolean // rings when a friend calls me (muted friends stay silent)
  notifSoundFile: string // name of the custom notification sound ('' = default sound), file in userData/sounds
  ringtoneFile: string // same for the ringtone
  windowOpacity: number // opacity of the window backgrounds, in % (30 → 100, 100 = opaque)
  windowMaterial: WindowMaterial // Windows 11 blur behind the translucent backgrounds
  launchAtStartup: boolean // launch the app at Windows sign-in
  canAutostart: boolean // read-only: false in dev (launch at startup targets the installed app)
  muted: string[] // keys of muted friends / rooms: no unread count, no toast, no flashing
  micId: string // chosen microphone ('' = the Windows default)
  speakerId: string // chosen audio output ('' = the Windows default)
  camId: string // chosen camera ('' = the first one found)
  mirrorCamera: boolean // my own camera preview is mirrored (display only: the others always receive it the right way round)
  echoCancellation: boolean // echo cancellation (native WebRTC)
  noiseSuppression: boolean // noise suppression (native WebRTC)
  autoGainControl: boolean // automatic microphone gain
  stealth: boolean // stealth mode: we only accept friends and members of our rooms
  voiceRelayOnly: boolean // voice: everything goes through a TURN relay, friends never see our IP
  turnUrl: string // TURN relay (turn: / turns:) used in relay mode
  turnUser: string
  turnPass: string
  hideNotificationContent: boolean // Windows toasts without the message text
  contentProtection: boolean // windows do not appear in screenshots / screen sharing
  imageTtlHours: number // default lifetime of shared images in my conversations (0 = never)
  autoUpdate: boolean // look for new versions on GitHub (it sees our IP); nothing is installed without asking
}

// WebRTC signal (offer, answer, ICE candidate) received from another member of the voice channel
export interface VoiceSignal {
  from: string
  room: string
  chan: string
  data: unknown
}

// Screen or window that can be shared (listed by the main process, shown in our own picker)
export interface ScreenSource {
  id: string // e.g. "screen:0:0", "window:1234:0"
  name: string
  kind: 'screen' | 'window'
  thumbnail: string // data URL (empty for a minimized window)
  icon: string // application icon, data URL (windows only, may be empty)
}

//& What the preload exposes to the windows (window.api)
// `convId` = key of a friend (private message) OR of a room: the core can tell the difference.
export interface ChatApi {
  getState: () => Promise<CoreState>
  setName: (name: string) => Promise<void>
  setAvatar: (avatar: Avatar) => Promise<void>
  addFriend: (code: string, nickname: string) => Promise<void>
  acceptRequest: (key: string) => Promise<void>
  declineRequest: (key: string) => Promise<void>
  createRoom: (name: string) => Promise<string>
  setRoomAvatar: (roomKey: string, avatar: Avatar) => Promise<void>
  createChannel: (roomKey: string, name: string, kind: ChannelKind) => Promise<void>
  renameRoom: (roomKey: string, name: string) => Promise<void>
  renameChannel: (roomKey: string, channelId: string, name: string) => Promise<void>
  deleteChannel: (roomKey: string, channelId: string) => Promise<void>
  kickFromRoom: (roomKey: string, memberKey: string) => Promise<void>
  leaveRoom: (roomKey: string) => Promise<void>
  sendFileBytes: (convId: string, name: string, bytes: Uint8Array, channel?: string, text?: string) => Promise<void>
  deleteMessage: (convId: string, id: string) => Promise<void>
  onMessageDeleted: (cb: (convId: string, id: string, author: string) => void) => () => void
  getImage: (coreKey: string) => Promise<string>
  saveFile: (coreKey: string, name: string) => Promise<boolean>
  setRoomImageTtl: (roomKey: string, hours: number | null) => Promise<void>
  onFileProgress: (cb: (coreKey: string, done: number, total: number) => void) => () => void
  deleteRoom: (roomKey: string) => Promise<void>
  removeFriend: (key: string) => Promise<void>
  inviteToRoom: (roomKey: string, friendKey: string) => Promise<void>
  acceptRoomInvite: (roomKey: string) => Promise<void>
  declineRoomInvite: (roomKey: string) => Promise<void>
  getHistory: (convId: string) => Promise<ChatMessage[]>
  send: (convId: string, text: string, channel?: string) => Promise<void>
  openChat: (friendKey: string) => Promise<void>
  openRoom: (roomKey: string) => Promise<void>
  // Home window switches: opens the window if closed, closes it otherwise
  toggleChat: (friendKey: string) => Promise<void>
  toggleRoom: (roomKey: string) => Promise<void>
  // Windows on screen ('chat:<key>', 'room:<key>'…) to highlight the friend or the room
  getVisibleWindows: () => Promise<string[]>
  onVisibleWindows: (cb: (ids: string[]) => void) => () => void
  getUnread: () => Promise<UnreadCounts>
  // App settings (Settings window)
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<void>
  openSettings: () => Promise<void>
  // After confirmation: starts from scratch. 'identity' = new key (we keep name, avatar, settings); 'all' = erase everything
  resetData: (mode: 'identity' | 'all') => Promise<void>
  // Encrypted identity backup. false = the user cancelled the file dialog; wrong passphrase / bad file → throws
  exportBackup: (passphrase: string) => Promise<boolean>
  importBackup: (passphrase: string) => Promise<boolean>
  onSettings: (cb: (settings: AppSettings) => void) => () => void
  onState: (cb: (state: CoreState) => void) => () => void
  onMessage: (cb: (convId: string, msg: ChatMessage) => void) => () => void
  onUnread: (cb: (unread: UnreadCounts) => void) => () => void
  // The main process asks ONE window to play the notification sound (it has no audio of its own)
  onNotifySound: (cb: () => void) => () => void
  // Same for the ringtone of an incoming call: true = start ringing, false = stop
  onNotifyRing: (cb: (on: boolean) => void) => () => void
  // Custom sounds: file picker (copies the file into the profile), back to default, bytes to play
  pickSound: (kind: SoundKind) => Promise<string | null>
  resetSound: (kind: SoundKind) => Promise<void>
  getSound: (kind: SoundKind) => Promise<Uint8Array | null>
  // Incoming call popup: join (opens the friend's window, which joins) or decline (stops ringing here)
  callAccept: (key: string) => Promise<void>
  callDecline: (key: string) => Promise<void>
  callTakeAutoJoin: (key: string) => Promise<boolean> // friend's window just opened from "Join"?
  onCallAutoJoin: (cb: () => void) => () => void // "Join" while the friend's window was already open
  onCallDeclined: (cb: () => void) => () => void // the friend I am calling refused (sent to their DM window)
  // Voice channels: the core handles presence and signaling, the window handles the audio (WebRTC)
  // Invite link received (junglemesh://add/<code>): code waiting for confirmation
  getPendingInvite: () => Promise<string | null>
  clearPendingInvite: () => Promise<void>
  onInviteLink: (cb: (code: string) => void) => () => void
  // Frameless window: buttons of our title bar and resize handles
  windowMinimize: () => void
  windowClose: () => void
  windowResizeStart: () => void
  windowResize: (edge: string, dx: number, dy: number) => void
  voiceJoin: (roomKey: string, channelId: string) => Promise<void>
  voiceLeave: () => Promise<void>
  voiceSignal: (to: string, roomKey: string, channelId: string, data: unknown) => Promise<void>
  onVoiceSignal: (cb: (signal: VoiceSignal) => void) => () => void
  // Screen sharing: list the sources, then remember the chosen one just before getDisplayMedia
  screenSources: () => Promise<ScreenSource[]>
  screenChoose: (sourceId: string, audio: boolean) => Promise<void>
}
