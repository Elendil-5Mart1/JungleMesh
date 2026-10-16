//* P2P core: identity, contacts, Hyperswarm connections, Hypercore conversations
// Lives in the main process, in a SINGLE instance. The windows only
// display what it sends them over IPC.
//
// How conversations work (step 2):
// each person owns, for each friend, a Hypercore where they write THEIR messages
// (a signed, append-only log). The friend receives a copy through replication.
// A conversation = my log + their log, merged by date.
// → history is persistent, and a message written while the friend is
//   offline is delivered automatically on their next connection.
// Group rooms (step 4) follow the same principle with N people: see rooms.ts.
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Protomux from 'protomux'
import c from 'compact-encoding'
import idEnc from 'hypercore-id-encoding'
import b4a from 'b4a'
import type { Avatar, ChannelKind, ChatMessage, CoreState, Friend, FriendStatus } from '../../shared/types'
import {
  cleanAvatar,
  cleanFileName,
  MAX_MESSAGE_LENGTH,
  deletedIds,
  findOwnMessage,
  orphanFiles,
  readMessages,
  readRaw,
  watchJournal,
  type JournalEntry,
  type SharedFile
} from './journal'
import { FileManager } from './files'
import { RoomManager, type RoomControl, type SavedRoom } from './rooms'
import { t } from '../../shared/i18n'
import { VoiceManager, type VoiceControl } from './voice'

//& Internal types
// Control message exchanged on connection (dedicated Protomux channel)
interface Hello {
  name: string
  avatar: Avatar // ~10 KB: sent on every connection, cached by the peer
  core: string | null // key of the log I write FOR you (null = not (yet) a friend)
}

interface Contact {
  key: string
  name: string
  status: FriendStatus | 'blocked'
  remoteCore: string | null // key of the friend's log
}

interface Peer {
  socket: any
  hello: any // Protomux message to send a Hello
  ctl: any // Protomux message for room control (invitations…)
}

const PROTOCOL = 'junglemesh/control/v1'
const MAX_CONTROL_SIZE = 300_000 // bytes: a Hello with an avatar is about 100 KB, a voice signal < 20 KB
const FLOOD_LIMIT = 600 // control messages per 10 s window beyond which the peer is cut off

// c.json, but refuses to decode an oversized message (otherwise a peer could make us allocate 16 MB for the string)
const boundedJson = {
  preencode: c.json.preencode,
  encode: c.json.encode,
  decode(state: { start: number; end: number }) {
    if (state.end - state.start > MAX_CONTROL_SIZE) throw new Error('control message too large')
    return c.json.decode(state)
  }
}
const MAX_PENDING_REQUESTS = 50 // anti-spam protection for friend requests
const HEX_KEY = /^[0-9a-f]{64}$/
const DM_CALL = 'dm' // channel id of a call between two friends (there is only one per pair)

export class P2PCore extends EventEmitter {
  private dataDir: string
  private store!: any // Corestore: manages all the Hypercores on disk
  private swarm!: any
  private publicKey = ''
  private name = 'Anonymous'
  private named = false // a display name was chosen (profile.json)
  private avatar: Avatar = null
  private avatars = new Map<string, string>() // cache: a peer's key → their avatar (avatars.json)

  private contacts = new Map<string, Contact>()
  private peers = new Map<string, Peer>() // connected peers (friends or room members)
  private peerNames = new Map<string, string>() // display name announced by each peer (Hello)
  private myCores = new Map<string, any>() // friend → my log for them
  private remoteCores = new Map<string, any>() // friend → their log
  private rooms!: RoomManager
  private files!: FileManager // shared files and images
  private voice!: VoiceManager // voice channels: presences + WebRTC signaling
  private writes = new Map<string, Promise<void>>() // file → last write in progress
  private stealth = false // stealth mode: only friends and members of our rooms can connect
  private floods = new Map<string, { count: number; since: number }>() // per-peer message flood protection

  constructor(dataDir: string) {
    super()
    this.dataDir = dataDir // folder where profile, contacts and logs are stored
  }

  //& Startup
  async start(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    // After an import (see backup.ts): restore.key holds the master key to give the new Corestore
    const restoreKey = join(this.dataDir, 'restore.key')
    const restored = existsSync(restoreKey) ? b4a.from(readFileSync(restoreKey, 'utf8').trim(), 'hex') : null
    this.store = new Corestore(
      join(this.dataDir, 'corestore'),
      restored?.length === 32 ? { primaryKey: restored, unsafe: true } : {}
    )
    await this.store.ready()
    this.files = new FileManager(this.store, (key, done, total) => this.emit('file-progress', key, done, total))
    if (restored) rmSync(restoreKey, { force: true }) // the key now lives in the Corestore, as for any identity

    // The identity is derived from the Corestore master key:
    // a single secret on disk, generated on first launch.
    const keyPair = await this.store.createKeyPair('identity')
    this.publicKey = b4a.toString(keyPair.publicKey, 'hex')

    const profile = await this.loadJson<{ name?: string; avatar?: Avatar }>('profile.json', {})
    if (profile.name) {
      this.name = profile.name
      this.named = true
    }
    this.avatar = cleanAvatar(profile.avatar) ?? null
    for (const [key, avatar] of Object.entries(await this.loadJson<Record<string, string>>('avatars.json', {}))) {
      if (cleanAvatar(avatar)) this.avatars.set(key, avatar)
    }
    for (const contact of await this.loadJson<Contact[]>('contacts.json', [])) {
      this.contacts.set(contact.key, contact)
    }

    // We reopen the logs of all our friends (and of sent requests)
    for (const contact of this.contacts.values()) {
      if (contact.status === 'accepted' || contact.status === 'outgoing') await this.openMyCore(contact.key)
      if (contact.status === 'accepted' && contact.remoteCore) await this.openRemoteCore(contact)
    }

    this.swarm = new Hyperswarm({
      keyPair,
      // By default only blocked contacts are refused: someone who is not yet
      // a friend must be able to connect to send us a request. They need
      // our invite code anyway to find us. Stealth mode closes that door.
      firewall: (remoteKey: Buffer) => this.refuses(b4a.toString(remoteKey, 'hex'))
    })
    this.swarm.on('connection', (socket: any, info: any) => this.onConnection(socket, info))

    // Rooms: the manager only receives what it needs from the core
    this.rooms = new RoomManager({
      store: this.store,
      swarm: this.swarm,
      me: () => ({ key: this.publicKey, name: this.name }),
      isFriend: (key) => this.contacts.get(key)?.status === 'accepted',
      displayName: (key) => this.displayName(key),
      avatar: (key) => (key === this.publicKey ? this.avatar : (this.avatars.get(key) ?? null)),
      isOnline: (key) => this.peers.has(key),
      sendControl: (key, msg) => this.sendControl(key, msg),
      save: (rooms) => this.saveJson('rooms.json', rooms),
      changed: () => this.emitState(),
      message: (roomKey, msg) => this.emit('message', roomKey, msg),
      messageDeleted: (roomKey, id, author) => this.deleted(roomKey, id, author)
    })
    this.voice = new VoiceManager({
      members: (room) => this.voiceMembers(room),
      me: () => this.publicKey,
      send: (key, msg) => this.sendControl(key, msg),
      changed: () => this.emitState(),
      signal: (signal) => this.emit('voice-signal', signal)
    })
    await this.rooms.load(await this.loadJson<SavedRoom[]>('rooms.json', []))

    await this.swarm.listen() // we announce ourselves on the DHT with our public key
    for (const contact of this.contacts.values()) {
      if (contact.status === 'accepted' || contact.status === 'outgoing') {
        this.swarm.joinPeer(b4a.from(contact.key, 'hex'))
      }
    }
  }

  // Should this peer be refused? (Hyperswarm firewall: the connection is cut before any exchange)
  private refuses(key: string): boolean {
    const status = this.contacts.get(key)?.status
    if (status === 'blocked') return true
    if (!this.stealth) return false
    return status === undefined && !this.rooms?.isKnownPeer(key)
  }

  // Stealth mode: a stranger, even with our code, sees neither our IP nor our display name.
  // Trade-off: they can no longer send us a request, we have to add their code ourselves.
  setStealth(on: boolean): void {
    if (on === this.stealth) return
    this.stealth = on
    if (!on) return
    for (const [key, peer] of this.peers) if (this.refuses(key)) peer.socket.destroy()
  }

  // A peer that floods the control channel is disconnected (denial-of-service protection)
  private flooded(key: string): boolean {
    const now = Date.now()
    const entry = this.floods.get(key)
    if (!entry || now - entry.since > 10_000) {
      this.floods.set(key, { count: 1, since: now })
      return false
    }
    if (++entry.count <= FLOOD_LIMIT) return false
    this.peers.get(key)?.socket.destroy()
    return true
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.writes.values()) // finish the saves in progress
    await this.swarm?.destroy()
    await this.store?.close()
  }

  // Master key (hex) for the identity backup: the only secret that cannot be re-created
  getPrimaryKey(): string {
    return b4a.toString(this.store.primaryKey, 'hex')
  }

  //& State sent to the windows
  getState(): CoreState {
    const friends: Friend[] = []
    for (const contact of this.contacts.values()) {
      if (contact.status === 'blocked') continue
      const callId = this.callId(contact.key)
      friends.push({
        key: contact.key,
        name: contact.name,
        avatar: this.avatars.get(contact.key) ?? null,
        status: contact.status,
        online: contact.status === 'accepted' && this.peers.has(contact.key),
        callId,
        call: this.voice?.participants(callId)[DM_CALL] ?? []
      })
    }
    return {
      me: {
        publicKey: this.publicKey,
        // Invite code = public key in base32 (52 characters, no 0/O, 1/l ambiguity)
        inviteCode: idEnc.encode(b4a.from(this.publicKey, 'hex')),
        name: this.name,
        named: this.named,
        avatar: this.avatar
      },
      friends,
      rooms: this.rooms.getState().map((r) => ({ ...r, voice: this.voice?.participants(r.key) ?? {} }))
    }
  }

  roomName(key: string): string | undefined {
    return this.rooms.name(key)
  }

  isRoom(key: string): boolean {
    return this.rooms.has(key)
  }

  //& Actions called from the windows
  async setName(name: string): Promise<void> {
    const clean = name.trim().slice(0, 32)
    if (clean) {
      this.name = clean
      this.named = true
    }
    await this.saveProfile()
  }

  async setAvatar(avatar: Avatar): Promise<void> {
    const clean = cleanAvatar(avatar)
    if (clean === undefined) throw new Error(t('err.invalidImage'))
    this.avatar = clean
    await this.saveProfile()
  }

  // Save + announce to connected peers (new Hello)
  private async saveProfile(): Promise<void> {
    await this.saveJson('profile.json', { name: this.name, avatar: this.avatar })
    for (const key of this.peers.keys()) await this.sendHello(key)
    this.emitState()
  }

  // Add by invite code (base32) or hex key
  async addFriend(code: string, nickname = ''): Promise<void> {
    let key: string
    try {
      // We also accept a link pasted as is (junglemesh://add/<code>)
      key = b4a.toString(idEnc.decode(code.trim().replace(/^junglemesh:\/\/add\//i, '').replace(/\/$/, '')), 'hex')
    } catch {
      throw new Error(t('err.invalidCode'))
    }
    if (key === this.publicKey) throw new Error(t('err.ownCode'))

    const existing = this.contacts.get(key)
    if (existing?.status === 'incoming') return this.acceptRequest(key) // they had already asked us
    if (existing && existing.status !== 'blocked') return

    this.contacts.set(key, {
      key,
      name: nickname.trim().slice(0, 32) || key.slice(0, 8),
      status: 'outgoing',
      remoteCore: null
    })
    await this.openMyCore(key)
    await this.saveContacts()
    this.swarm.joinPeer(b4a.from(key, 'hex'))
    if (this.peers.has(key)) await this.sendHello(key)
    this.emitState()
  }

  async acceptRequest(key: string): Promise<void> {
    const contact = this.contacts.get(key)
    if (!contact || contact.status !== 'incoming') return

    contact.status = 'accepted'
    await this.openMyCore(key)
    if (contact.remoteCore) await this.openRemoteCore(contact)
    await this.saveContacts()
    this.swarm.joinPeer(b4a.from(key, 'hex'))
    // Our Hello now contains our log's key = "I accept"
    if (this.peers.has(key)) await this.sendHello(key)
    this.emitState()
  }

  async declineRequest(key: string): Promise<void> {
    const contact = this.contacts.get(key)
    if (!contact || contact.status !== 'incoming') return

    contact.status = 'blocked' // they will no longer be able to connect (firewall)
    this.peers.get(key)?.socket.destroy()
    await this.saveContacts()
    this.emitState()
  }

  // Remove a friend (or cancel a request I sent). The contact becomes 'blocked', like a declined request:
  // they cannot reappear as a new request, and I can still add them back later with their code.
  async removeFriend(key: string): Promise<void> {
    const contact = this.contacts.get(key)
    if (!contact || (contact.status !== 'accepted' && contact.status !== 'outgoing')) return

    contact.status = 'blocked'
    contact.remoteCore = null
    this.swarm.leavePeer(b4a.from(key, 'hex'))
    this.peers.get(key)?.socket.destroy()
    // We stop reading their messages; the logs stay on disk, so adding them again brings the history back
    for (const cores of [this.myCores, this.remoteCores]) {
      void cores.get(key)?.close().catch(() => {})
      cores.delete(key)
    }
    await this.saveContacts()
    this.emitState()
  }

  //& Rooms (delegated to the RoomManager)
  createRoom(name: string): Promise<string> {
    return this.rooms.create(name)
  }

  setRoomAvatar(roomKey: string, avatar: Avatar): Promise<void> {
    return this.rooms.setAvatar(roomKey, avatar)
  }

  createChannel(roomKey: string, name: string, kind: ChannelKind): Promise<void> {
    return this.rooms.createChannel(roomKey, name, kind)
  }

  renameRoom(roomKey: string, name: string): Promise<void> {
    return this.rooms.renameRoom(roomKey, name)
  }

  renameChannel(roomKey: string, channelId: string, name: string): Promise<void> {
    return this.rooms.renameChannel(roomKey, channelId, name)
  }

  deleteChannel(roomKey: string, channelId: string): Promise<void> {
    return this.rooms.deleteChannel(roomKey, channelId)
  }

  kickFromRoom(roomKey: string, memberKey: string): Promise<void> {
    return this.rooms.kick(roomKey, memberKey)
  }

  //& Voice channels (audio goes through WebRTC in the window; here: presence and signaling)
  // A call between two friends reuses the voice machinery with a "virtual room" shared by both:
  // its id is a hash of the two public keys, sorted, so each side computes the same one.
  private callId(friendKey: string): string {
    return createHash('sha256')
      .update([this.publicKey, friendKey].sort().join(':'))
      .digest('hex')
  }

  // Friend (accepted) behind a call id, if any
  private callPeer(callId: string): string | null {
    for (const c of this.contacts.values()) if (c.status === 'accepted' && this.callId(c.key) === callId) return c.key
    return null
  }

  // Who may be in this voice "room": the signed-up members of a room, or me + the friend of a call
  private voiceMembers(room: string): string[] {
    const members = this.rooms.memberKeys(room)
    if (members.length) return members
    const peer = this.callPeer(room)
    return peer ? [this.publicKey, peer] : []
  }

  voiceJoin(roomKey: string, channelId: string): void {
    const isCall = channelId === DM_CALL && !!this.callPeer(roomKey)
    if (!isCall && !this.rooms.isVoiceChannel(roomKey, channelId)) throw new Error(t('err.notVoiceChannel'))
    this.voice.join(roomKey, channelId)
  }

  voiceLeave(): void {
    this.voice.leave()
  }

  voiceSignal(to: string, roomKey: string, channelId: string, data: unknown): void {
    this.voice.signal(to, roomKey, channelId, data)
  }

  deleteRoom(roomKey: string): Promise<void> {
    return this.rooms.deleteRoom(roomKey)
  }

  leaveRoom(roomKey: string): Promise<void> {
    return this.rooms.leave(roomKey)
  }

  inviteToRoom(roomKey: string, friendKey: string): Promise<void> {
    return this.rooms.invite(roomKey, friendKey)
  }

  acceptRoomInvite(roomKey: string): Promise<void> {
    return this.rooms.accept(roomKey)
  }

  declineRoomInvite(roomKey: string): Promise<void> {
    return this.rooms.decline(roomKey)
  }

  //& Conversations: convId = key of a friend OR of a room
  async getHistory(convId: string): Promise<ChatMessage[]> {
    if (this.rooms.has(convId)) return this.rooms.getHistory(convId)
    const messages: ChatMessage[] = []
    const mine = this.myCores.get(convId)
    const theirs = this.remoteCores.get(convId)
    if (mine) messages.push(...(await readMessages(mine, this.publicKey)))
    if (theirs) messages.push(...(await readMessages(theirs, convId)))
    return messages.sort((a, b) => a.ts - b.ts)
  }

  async send(convId: string, text: string, channel?: string, file?: SharedFile): Promise<void> {
    if (this.rooms.has(convId)) return this.rooms.send(convId, text, channel, file)
    const friendKey = convId
    const core = this.myCores.get(friendKey)
    if (!core || this.contacts.get(friendKey)?.status !== 'accepted') {
      throw new Error(t('err.notAcceptedYet'))
    }
    // We write to our log; replication takes care of delivery,
    // immediately if the friend is connected, otherwise on their next connection.
    const entry: JournalEntry = { id: randomUUID(), text: text.slice(0, MAX_MESSAGE_LENGTH), ts: Date.now(), ...(file && { file }) }
    await core.append(entry)
  }

  //& Deleting my own messages (a tombstone in my log, see journal.ts)
  async deleteMessage(convId: string, id: string): Promise<void> {
    if (this.rooms.has(convId)) return this.rooms.deleteMessage(convId, id)
    const core = this.myCores.get(convId)
    if (!core || this.contacts.get(convId)?.status !== 'accepted') throw new Error(t('err.notAcceptedYet'))
    const own = await findOwnMessage(core, id)
    if (!own) return
    await core.append({ type: 'delete', id, ...(own.file && { file: own.file }), ts: Date.now() } satisfies JournalEntry)
  }

  // A message was deleted by its author: the windows hide it, and its image (if any) is freed from the disk
  private deleted(convId: string, id: string, author: string): void {
    this.emit('message-deleted', convId, id, author)
    void this.flushOrphans()
  }

  private async flushOrphans(): Promise<void> {
    for (const key of [...orphanFiles]) {
      orphanFiles.delete(key)
      await this.files.release(key).catch(() => {})
    }
  }

  //& Files and images (the bytes travel in their own log, see files.ts)
  async sendFile(convId: string, fileName: string, data: Buffer, channel?: string, text = ''): Promise<void> {
    const file = await this.files.publish(cleanFileName(fileName), data)
    await this.send(convId, text, channel, file)
  }

  readFile(coreKey: string): Promise<Buffer> {
    return this.files.read(coreKey)
  }

  imageDataUrl(coreKey: string): Promise<string> {
    return this.files.imageDataUrl(coreKey)
  }

  // After a download to the user's disk: the copy kept in the app's own storage is freed
  releaseFile(coreKey: string): Promise<void> {
    return this.files.release(coreKey)
  }

  //& Image lifetime: a shared image disappears after a delay (0 = never).
  // Rooms: the creator's choice, written in the registry; otherwise (and in DMs) my own default.
  private imageTtlHours = 72
  setImageTtl(hours: number): void {
    this.imageTtlHours = hours
  }

  // Frees the blocks of the images that have outlived their delay (the windows hide them by the same rule)
  async purgeExpiredImages(): Promise<void> {
    const now = Date.now()
    await this.flushOrphans() // images of messages deleted while we were away
    const sweep = async (convId: string, hours: number): Promise<void> => {
      if (hours <= 0) return
      for (const msg of await this.getHistory(convId)) {
        if (msg.file?.image && now - Math.min(msg.ts, now) > hours * 3_600_000) await this.files.release(msg.file.core)
      }
    }
    for (const c of this.contacts.values()) if (c.status === 'accepted') await sweep(c.key, this.imageTtlHours)
    for (const r of this.rooms.getState()) {
      if (r.status === 'joined') await sweep(r.key, r.imageTtl ?? this.imageTtlHours)
    }
  }

  setRoomImageTtl(roomKey: string, hours: number | null): Promise<void> {
    return this.rooms.setImageTtl(roomKey, hours)
  }

  //& Connections
  private onConnection(socket: any, info: any): void {
    const key = b4a.toString(info.publicKey, 'hex')
    socket.on('error', () => {}) // network errors always end in 'close'

    // A single encrypted connection carries two protocols thanks to Protomux:
    // 1. our control channel (Hello), 2. Hypercore replication.
    const mux = Protomux.from(socket)
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      onopen: () => void this.sendHello(key)
    })
    if (!channel) return socket.destroy()

    const hello = channel.addMessage({
      encoding: boundedJson,
      onmessage: (msg: unknown) => {
        if (!this.flooded(key)) void this.onHello(key, msg)
      }
    })
    // 2nd message type on the same channel (the order of addition must be the same on both sides)
    const ctl = channel.addMessage({
      encoding: boundedJson,
      onmessage: (msg: unknown) => {
        if (!this.flooded(key)) this.onControl(key, msg)
      }
    })
    channel.open()

    // Replication only gives access to the logs whose key the peer knows.
    // A stranger receives no key until we accept them → they see nothing.
    this.store.replicate(socket)

    this.peers.set(key, { socket, hello, ctl })
    this.emitState()

    socket.on('close', () => {
      // Hyperswarm may replace a connection with a more recent one
      if (this.peers.get(key)?.socket !== socket) return
      this.peers.delete(key)
      this.voice?.onPeerGone(key)
      this.emitState()
    })
  }

  private async sendHello(key: string): Promise<void> {
    const peer = this.peers.get(key)
    if (!peer) return
    const contact = this.contacts.get(key)
    const isFriendly = contact?.status === 'accepted' || contact?.status === 'outgoing'
    const myCore = isFriendly ? await this.openMyCore(key) : null
    const hello: Hello = { name: this.name, avatar: this.avatar, core: myCore ? b4a.toString(myCore.key, 'hex') : null }
    peer.hello.send(hello)
  }

  private async onHello(key: string, raw: unknown): Promise<void> {
    // We never trust received content: every field is validated
    const msg = raw as Partial<Hello>
    if (typeof msg?.name !== 'string') return
    const name = msg.name.trim().slice(0, 32) || key.slice(0, 8)
    const remoteCore = typeof msg.core === 'string' && HEX_KEY.test(msg.core) ? msg.core : null
    this.peerNames.set(key, name) // useful to display the members of a room who are not friends
    this.rememberAvatar(key, cleanAvatar(msg.avatar))

    const contact = this.contacts.get(key)

    if (!contact) {
      // Stranger without a log for us: probably a member of a shared room
      if (!remoteCore) {
        this.rooms.onPeerReady(key)
        this.voice.onPeerReady(key)
        return this.emitState()
      }
      // Stranger who sends us their log = friend request
      const pending = [...this.contacts.values()].filter((c) => c.status === 'incoming').length
      if (pending >= MAX_PENDING_REQUESTS) return
      this.contacts.set(key, { key, name, status: 'incoming', remoteCore })
    } else if (contact.status === 'blocked') {
      return
    } else {
      contact.name = name
      if (remoteCore) contact.remoteCore = remoteCore
      // Request sent + they send us their log = they accepted
      if (contact.status === 'outgoing' && remoteCore) contact.status = 'accepted'
      if (contact.status === 'accepted' && contact.remoteCore) await this.openRemoteCore(contact)
    }

    await this.saveContacts()
    this.rooms.onPeerReady(key) // pending room invitations / sign-ups
    this.voice.onPeerReady(key) // I tell them which voice channel I am in
    this.emitState()
  }

  // The control channel carries room AND voice messages: we dispatch by type
  private onControl(key: string, msg: unknown): void {
    const type = (msg as { type?: unknown })?.type
    if (typeof type === 'string' && type.startsWith('voice-')) this.voice.onControl(key, msg)
    else void this.rooms.onControl(key, msg)
  }

  private sendControl(key: string, msg: RoomControl | VoiceControl): boolean {
    const peer = this.peers.get(key)
    if (!peer) return false
    peer.ctl.send(msg)
    return true
  }

  // Updates the avatar cache (undefined = missing or invalid field: we keep the old one)
  private rememberAvatar(key: string, avatar: Avatar | undefined): void {
    if (avatar === undefined || (this.avatars.get(key) ?? null) === avatar) return
    if (avatar) this.avatars.set(key, avatar)
    else this.avatars.delete(key)
    void this.saveJson('avatars.json', Object.fromEntries(this.avatars))
  }

  // Name to display: the friend's nickname/name if they are in our contacts, otherwise their announced display name
  private displayName(key: string): string | undefined {
    const contact = this.contacts.get(key)
    if (contact && contact.status !== 'blocked') return contact.name
    return this.peerNames.get(key)
  }

  //& Hypercore logs
  private async openMyCore(friendKey: string): Promise<any> {
    let core = this.myCores.get(friendKey)
    if (core) return core

    // The name always gives the same log (key derived from the master key)
    core = this.store.get({ name: `dm:${friendKey}`, valueEncoding: 'json' })
    this.myCores.set(friendKey, core)
    await core.ready()
    this.watchMessages(core, friendKey, this.publicKey)
    return core
  }

  private async openRemoteCore(contact: Contact): Promise<void> {
    if (!contact.remoteCore || this.remoteCores.has(contact.key)) return

    const core = this.store.get({ key: b4a.from(contact.remoteCore, 'hex'), valueEncoding: 'json' })
    this.remoteCores.set(contact.key, core)
    await core.ready()
    // Continuous download of the whole log, present and future
    core.download({ start: 0, end: -1 })
    this.watchMessages(core, contact.key, contact.key)
  }

  // Emits a 'message' event for each new entry of a DM log
  private watchMessages(core: any, friendKey: string, author: string): void {
    watchJournal(core, async (from) => {
      for (const msg of await readMessages(core, author, from)) this.emit('message', friendKey, msg)
      for (const id of deletedIds(await readRaw(core, from), author)) this.deleted(friendKey, id, author)
    })
  }

  //& Utilities
  private emitState(): void {
    // Room left or removed during a call: no more voice channel
    const spot = this.voice?.current()
    if (spot && this.voiceMembers(spot.room).length === 0) this.voice.onRoomGone(spot.room)
    this.emit('state', this.getState())
  }

  private saveContacts(): Promise<void> {
    return this.saveJson('contacts.json', [...this.contacts.values()])
  }

  private async loadJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.dataDir, file), 'utf-8'))
    } catch {
      return fallback
    }
  }

  // Queued writes (one at a time per file) and atomic:
  // we write a .tmp then rename it, so the file is never half-written.
  private saveJson(file: string, data: unknown): Promise<void> {
    const path = join(this.dataDir, file)
    const json = JSON.stringify(data, null, 2) // snapshot taken NOW
    const previous = this.writes.get(file) ?? Promise.resolve()
    const next = previous
      .catch(() => {}) // a previous failure does not block the following ones
      .then(async () => {
        await writeFile(`${path}.tmp`, json)
        await rename(`${path}.tmp`, path)
      })
    this.writes.set(file, next)
    return next
  }
}
