//* Group rooms (≈ Discord servers): several members, channels, each one writes in THEIR own log
//
// How it works (same idea as private messages, generalized to N people):
// - The room is identified by the key of its creator's log.
// - This creator's log also serves as a signed REGISTRY: room name and icon ('meta'),
//   members with the key of their log ('member'), text/voice channels ('channel').
//   Nobody but the creator can write to it.
// - Each member writes their messages in their own log for this room;
//   each message states its channel.
// - All members join a Hyperswarm "topic" specific to the room: they
//   connect to each other even if they are not friends, and relay the logs to each other
//   (a message from an offline member arrives through any other member).
//
// Invitation: the creator invites a friend → the friend accepts and sends them the key of their
// log (room-join) → the creator signs them up in the registry → everyone sees them.
import { randomUUID } from 'node:crypto'
import b4a from 'b4a'
import type { Avatar, Channel, ChannelKind, ChatMessage, Room, RoomStatus } from '../../shared/types'
import { t } from '../../shared/i18n'
import {
  cleanAvatar,
  cleanChannelId,
  MAX_MESSAGE_LENGTH,
  readRaw,
  toMessage,
  watchJournal,
  deletedIds,
  findOwnMessage,
  withoutDeleted,
  type JournalEntry,
  type SharedFile
} from './journal'

const MAX_TTL_HOURS = 24 * 365 // longest image lifetime a creator can set: one year (0 = never)

//& Types
// Room-related control messages (sent over the Protomux channel between two friends)
export type RoomControl =
  { type: 'room-invite'; room: string; name: string; owner: string } | { type: 'room-join'; room: string; core: string }

// What is saved in rooms.json
export interface SavedRoom {
  key: string
  name: string
  owner: string // creator's public key
  status: RoomStatus
  coreName: string // Corestore name of MY log in this room
  invitedBy: string
  inviter?: string // key of the person who invited me (missing = the creator, old rooms)
  leaving?: boolean // I left the room: hidden until the creator removes me from the registry
  pendingInvites: string[]
}

interface Member {
  key: string
  core: string
  name: string
  since: number // sign-up date: an older 'leave' request is ignored
}

// "Live" room in memory
interface RoomRuntime {
  saved: SavedRoom
  avatar: Avatar
  imageTtl?: number // hours before shared images disappear (chosen by the creator; missing = each member's default)
  ownerCore: any // registry + creator's messages
  myCore: any | null // my log (= ownerCore if I am the creator)
  members: Map<string, Member>
  channels: Map<string, Channel> // in creation order
  cores: Map<string, any> // member → their log
  removedAt: Map<string, number> // former member → date of their removal (ignores their old requests)
  enrolling: Set<string> // (creator) members being signed up, avoids duplicates
  active: boolean
}

// What the manager needs from the core (avoids giving it access to everything)
export interface RoomHost {
  store: any
  swarm: any
  me: () => { key: string; name: string }
  isFriend: (key: string) => boolean
  displayName: (key: string) => string | undefined
  avatar: (key: string) => Avatar
  isOnline: (key: string) => boolean
  sendControl: (key: string, msg: RoomControl) => boolean
  save: (rooms: SavedRoom[]) => Promise<void>
  changed: () => void
  message: (roomKey: string, msg: ChatMessage) => void
  messageDeleted: (roomKey: string, id: string, author: string) => void
}

const HEX_KEY = /^[0-9a-f]{64}$/
const MAX_ROOM_INVITES = 50 // anti-spam: pending invitations
const MAX_MEMBERS = 50
const MAX_CHANNELS = 50
// Implicit text channel: always exists, even in rooms created before channels
const GENERAL: Channel = { id: 'general', name: 'general', kind: 'text' }

const hex = (buf: Buffer): string => b4a.toString(buf, 'hex')
const cleanName = (name: unknown): string => (typeof name === 'string' ? name.trim().slice(0, 48) : '')
// Discord-style text channel name: lowercase, dashes instead of spaces
const textChannelName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 32)

export class RoomManager {
  private host: RoomHost
  private rooms = new Map<string, RoomRuntime>()

  constructor(host: RoomHost) {
    this.host = host
  }

  //& Loading at startup
  async load(saved: SavedRoom[]): Promise<void> {
    for (const s of saved) await this.open(s)
  }

  has(key: string): boolean {
    return this.rooms.has(key)
  }

  name(key: string): string | undefined {
    return this.rooms.get(key)?.saved.name
  }

  //& State sent to the windows
  getState(): Room[] {
    const me = this.host.me().key
    return [...this.rooms.values()]
      .filter((r) => !r.saved.leaving)
      .map(({ saved, avatar, imageTtl, members, channels }) => ({
        key: saved.key,
        name: saved.name,
        avatar,
        imageTtl,
        status: saved.status,
        isOwner: saved.owner === me,
        invitedBy: saved.invitedBy,
        members: [...members.values()].map((m) => ({
          key: m.key,
          name: m.key === me ? this.host.me().name : (this.host.displayName(m.key) ?? m.name),
          avatar: this.host.avatar(m.key),
          online: m.key === me || this.host.isOnline(m.key),
          isOwner: m.key === saved.owner
        })),
        channels: channels.has(GENERAL.id) ? [...channels.values()] : [GENERAL, ...channels.values()],
        pendingInvites: [...saved.pendingInvites],
        voice: {} // filled in by the core (voice presences)
      }))
  }

  // Keys of the signed-up members (empty if we are not signed up ourselves: no voice before that)
  memberKeys(roomKey: string): string[] {
    const rt = this.rooms.get(roomKey)
    if (!rt || rt.saved.leaving || rt.saved.status !== 'joined') return []
    return [...rt.members.keys()]
  }

  // Does this key belong to a room we know (signed-up member or creator)? Used by stealth mode.
  isKnownPeer(key: string): boolean {
    for (const rt of this.rooms.values()) {
      if (rt.saved.owner === key || rt.members.has(key)) return true
    }
    return false
  }

  // Does the channel exist and is it a voice channel?
  isVoiceChannel(roomKey: string, channelId: string): boolean {
    return this.rooms.get(roomKey)?.channels.get(channelId)?.kind === 'voice'
  }

  //& Actions
  async create(name: string): Promise<string> {
    const roomName = cleanName(name)
    if (!roomName) throw new Error(t('err.roomNameRequired'))
    const me = this.host.me()

    const coreName = `room-own:${randomUUID()}`
    const core = this.host.store.get({ name: coreName, valueEncoding: 'json' })
    await core.ready()
    const key = hex(core.key)

    await this.open({
      key,
      name: roomName,
      owner: me.key,
      status: 'joined',
      coreName,
      invitedBy: '',
      pendingInvites: []
    })
    await this.persist()
    // First registry entries: the name, me as first member, and two default channels
    const ts = Date.now()
    await core.append({ type: 'meta', name: roomName, ts } satisfies JournalEntry)
    await core.append({ type: 'member', key: me.key, core: key, name: me.name, ts } satisfies JournalEntry)
    await core.append({ type: 'channel', id: GENERAL.id, name: GENERAL.name, kind: 'text', ts } satisfies JournalEntry)
    await core.append({ type: 'channel', id: randomUUID(), name: t('room.defaultVoiceName'), kind: 'voice', ts } satisfies JournalEntry)
    return key
  }

  // Room icon: one more 'meta' entry in the registry (creator only)
  async setAvatar(roomKey: string, avatar: Avatar): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    const clean = cleanAvatar(avatar)
    if (clean === undefined) throw new Error(t('err.invalidImage'))
    await rt.ownerCore.append({ type: 'meta', avatar: clean, ts: Date.now() } satisfies JournalEntry)
  }

  // Lifetime of the images shared in the room (creator only): hours, 0 = never, null = back to each member's default
  async setImageTtl(roomKey: string, hours: number | null): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    if (hours !== null && !(Number.isInteger(hours) && hours >= 0 && hours <= MAX_TTL_HOURS)) throw new Error(t('err.invalidDelay'))
    await rt.ownerCore.append({ type: 'meta', imageTtl: hours, ts: Date.now() } satisfies JournalEntry)
  }

  async createChannel(roomKey: string, name: string, kind: ChannelKind): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    const clean = this.channelName(kind, name)
    if (!clean) throw new Error(t('err.channelNameRequired'))
    if (rt.channels.size >= MAX_CHANNELS) throw new Error(t('err.tooManyChannels'))
    await rt.ownerCore.append({
      type: 'channel',
      id: randomUUID(),
      name: clean,
      kind,
      ts: Date.now()
    } satisfies JournalEntry)
  }

  async renameRoom(roomKey: string, name: string): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    const clean = cleanName(name)
    if (!clean) throw new Error(t('err.roomNameRequired'))
    await rt.ownerCore.append({ type: 'meta', name: clean, ts: Date.now() } satisfies JournalEntry)
  }

  async renameChannel(roomKey: string, channelId: string, name: string): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    const channel = rt.channels.get(channelId)
    if (!channel || channelId === GENERAL.id) throw new Error(t('err.channelNotRenamable'))
    const clean = this.channelName(channel.kind, name)
    if (!clean) throw new Error(t('err.channelNameRequired'))
    await rt.ownerCore.append({
      type: 'channel-rename',
      id: channelId,
      name: clean,
      ts: Date.now()
    } satisfies JournalEntry)
  }

  async deleteChannel(roomKey: string, channelId: string): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    if (!rt.channels.has(channelId) || channelId === GENERAL.id) throw new Error(t('err.channelNotDeletable'))
    await rt.ownerCore.append({ type: 'channel-delete', id: channelId, ts: Date.now() } satisfies JournalEntry)
  }

  // Remove a member (creator). They lose access to the room in the app, but what they already
  // replicated stays on their disk: you cannot "un-share" data.
  async kick(roomKey: string, memberKey: string): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    const member = rt.members.get(memberKey)
    if (!member || memberKey === rt.saved.owner) throw new Error(t('err.memberNotFound'))
    await this.removeMember(rt, member, 'kicked')
  }

  // Delete the room (creator): a last registry entry tells every member's app to forget it.
  // Like a kick, it cannot erase what members already replicated on their disk.
  async deleteRoom(roomKey: string): Promise<void> {
    const rt = this.ownedRoom(roomKey)
    await rt.ownerCore.append({ type: 'room-delete', ts: Date.now() } satisfies JournalEntry)
    // The registry watcher drops the room (see applyRegistry); done here too in case it is slow
    await this.forget(rt)
  }

  // Leave a room: we tell the creator through our log, and hide it right away
  async leave(roomKey: string): Promise<void> {
    const rt = this.rooms.get(roomKey)
    if (!rt) return
    if (rt.saved.owner === this.host.me().key) throw new Error(t('err.ownerCannotLeave'))
    if (rt.saved.status === 'joined' && rt.myCore) {
      await rt.myCore.append({ type: 'leave', ts: Date.now() } satisfies JournalEntry)
      rt.saved.leaving = true // we wait for the creator to remove us before erasing everything
    } else {
      this.dropRoom(rt) // not signed up yet: nothing to announce
    }
    await this.persist()
    this.host.changed()
  }

  // Any signed-up member can invite one of THEIR friends (not only the creator)
  async invite(roomKey: string, friendKey: string): Promise<void> {
    const rt = this.rooms.get(roomKey)
    if (!rt || rt.saved.status !== 'joined') throw new Error(t('err.mustBeEnrolled'))
    if (!this.host.isFriend(friendKey)) throw new Error(t('err.friendsOnly'))
    if (rt.members.has(friendKey)) return
    if (rt.members.size + rt.saved.pendingInvites.length >= MAX_MEMBERS) throw new Error(t('err.roomFull'))

    if (!rt.saved.pendingInvites.includes(friendKey)) rt.saved.pendingInvites.push(friendKey)
    await this.persist()
    // Friend offline? The invitation will go out on their next connection (see onPeerReady)
    this.sendInvite(rt, friendKey)
    this.host.changed()
  }

  async accept(roomKey: string): Promise<void> {
    const rt = this.rooms.get(roomKey)
    if (!rt || rt.saved.status !== 'invited') return
    rt.saved.status = 'joining'
    await this.persist()
    await this.activate(rt)
    this.sendJoin(rt)
    this.host.changed()
  }

  async decline(roomKey: string): Promise<void> {
    const rt = this.rooms.get(roomKey)
    if (!rt || rt.saved.status !== 'invited') return
    this.rooms.delete(roomKey)
    await this.persist()
    this.host.changed()
  }

  async getHistory(roomKey: string): Promise<ChatMessage[]> {
    const rt = this.rooms.get(roomKey)
    if (!rt?.active) return []
    const ownerRaws = await readRaw(rt.ownerCore)
    const messages = withoutDeleted(ownerRaws, this.ownerEntriesToMessages(rt, ownerRaws, 0), rt.saved.owner)
    const others: [string, any][] = [...rt.cores]
    if (rt.myCore && rt.myCore !== rt.ownerCore) others.push([this.host.me().key, rt.myCore])
    for (const [author, core] of others) {
      const raws = await readRaw(core)
      const list: ChatMessage[] = []
      for (const raw of raws) {
        const msg = toMessage(raw, author)
        if (msg) list.push(msg)
      }
      messages.push(...withoutDeleted(raws, list, author))
    }
    return messages.sort((a, b) => a.ts - b.ts)
  }

  async send(roomKey: string, text: string, channel = GENERAL.id, file?: SharedFile): Promise<void> {
    const rt = this.rooms.get(roomKey)
    if (!rt?.myCore || rt.saved.status !== 'joined') {
      throw new Error(t('err.notEnrolledYet'))
    }
    const target = channel === GENERAL.id ? GENERAL : rt.channels.get(channel)
    if (target?.kind !== 'text') throw new Error(t('err.textChannelNotFound'))
    const entry: JournalEntry = {
      id: randomUUID(),
      text: text.slice(0, MAX_MESSAGE_LENGTH),
      ts: Date.now(),
      ...(channel !== GENERAL.id && { channel }), // 'general' is not written (compatibility)
      ...(file && { file })
    }
    await rt.myCore.append(entry)
  }

  // Delete one of MY messages in a room (a tombstone in my own log)
  async deleteMessage(roomKey: string, id: string): Promise<void> {
    const rt = this.rooms.get(roomKey)
    if (!rt?.myCore || rt.saved.status !== 'joined') throw new Error(t('err.notEnrolledYet'))
    const own = await findOwnMessage(rt.myCore, id)
    if (!own) return
    await rt.myCore.append({ type: 'delete', id, ...(own.file && { file: own.file }), ts: Date.now() } satisfies JournalEntry)
  }

  //& Control messages received from a friend
  async onControl(from: string, raw: unknown): Promise<void> {
    const msg = raw as Partial<{ type: string; room: string; name: string; core: string; owner: string }>
    if (typeof msg?.room !== 'string' || !HEX_KEY.test(msg.room)) return

    if (msg.type === 'room-invite') {
      // Only a friend can invite us, and we ignore an already known room
      if (!this.host.isFriend(from) || this.rooms.has(msg.room)) return
      const invited = [...this.rooms.values()].filter((r) => r.saved.status === 'invited').length
      if (invited >= MAX_ROOM_INVITES) return
      // The creator is not necessarily the one who invites us: we remember WHO (inviter) to reply to them.
      // The creator identity announced here is provisional: the signed registry will confirm it (see applyRegistry).
      const owner = typeof msg.owner === 'string' && HEX_KEY.test(msg.owner) ? msg.owner : from
      await this.open({
        key: msg.room,
        name: cleanName(msg.name) || t('room.fallbackName'),
        owner,
        status: 'invited',
        coreName: `room:${msg.room}`,
        invitedBy: this.host.displayName(from) ?? from.slice(0, 8),
        inviter: from,
        pendingInvites: []
      })
      await this.persist()
      this.host.changed()
    }

    if (msg.type === 'room-join') {
      // A signed-up member registers someone THEY invited
      const rt = this.rooms.get(msg.room)
      if (!rt || rt.saved.status !== 'joined' || !rt.myCore) return
      if (!rt.saved.pendingInvites.includes(from)) return
      if (typeof msg.core !== 'string' || !HEX_KEY.test(msg.core)) return

      rt.saved.pendingInvites = rt.saved.pendingInvites.filter((k) => k !== from)
      await this.persist()
      const name = this.host.displayName(from) ?? from.slice(0, 8)
      if (rt.saved.owner === this.host.me().key) {
        await this.enroll(rt, { key: from, core: msg.core, name })
      } else {
        // I am not the creator: I ask for it in MY log, they will read it through replication
        await rt.myCore.append({ type: 'join', key: from, core: msg.core, name, ts: Date.now() } satisfies JournalEntry)
        this.host.changed()
      }
    }
  }

  // A peer just introduced itself (Hello received): we send back what was pending
  onPeerReady(key: string): void {
    for (const rt of this.rooms.values()) {
      if (rt.saved.pendingInvites.includes(key)) this.sendInvite(rt, key)
      if (rt.saved.status === 'joining' && (rt.saved.inviter ?? rt.saved.owner) === key) this.sendJoin(rt)
    }
  }

  //& Internal
  private ownedRoom(roomKey: string): RoomRuntime {
    const rt = this.rooms.get(roomKey)
    if (!rt || rt.saved.owner !== this.host.me().key) throw new Error(t('err.ownerOnly'))
    return rt
  }

  private async open(saved: SavedRoom): Promise<RoomRuntime> {
    const isOwner = saved.owner === this.host.me().key
    const ownerCore = isOwner
      ? this.host.store.get({ name: saved.coreName, valueEncoding: 'json' })
      : this.host.store.get({ key: b4a.from(saved.key, 'hex'), valueEncoding: 'json' })
    await ownerCore.ready()

    const rt: RoomRuntime = {
      saved,
      avatar: null,
      ownerCore,
      myCore: null,
      members: new Map(),
      channels: new Map(),
      cores: new Map(),
      removedAt: new Map(),
      enrolling: new Set(),
      active: false
    }
    this.rooms.set(saved.key, rt)
    // Simple invitation: nothing is downloaded until it is accepted
    if (saved.status !== 'invited') await this.activate(rt)
    return rt
  }

  // Connects the room to the network: download, registry reading, Hyperswarm topic
  private async activate(rt: RoomRuntime): Promise<void> {
    if (rt.active) return
    rt.active = true
    const isOwner = rt.saved.owner === this.host.me().key

    if (isOwner) {
      rt.myCore = rt.ownerCore
    } else {
      rt.ownerCore.download({ start: 0, end: -1 })
      rt.myCore = this.host.store.get({ name: rt.saved.coreName, valueEncoding: 'json' })
      await rt.myCore.ready()
      watchJournal(rt.myCore, async (from) => this.emitFrom(rt, rt.myCore, this.host.me().key, from))
    }

    // Registry already on disk, then watching for new entries
    await this.applyRegistry(rt, await readRaw(rt.ownerCore))
    watchJournal(rt.ownerCore, async (from) => {
      const raws = await readRaw(rt.ownerCore, from)
      await this.applyRegistry(rt, raws)
      for (const msg of withoutDeleted(raws, this.ownerEntriesToMessages(rt, raws, from), rt.saved.owner)) this.post(rt, msg)
      for (const id of deletedIds(raws, rt.saved.owner)) this.postDeleted(rt, id, rt.saved.owner)
    })

    // The topic = the registry's discoveryKey: only those who know the room can find it
    this.host.swarm.join(rt.ownerCore.discoveryKey, { client: true, server: true })
  }

  // Applies the registry entries (creator's log only)
  private async applyRegistry(rt: RoomRuntime, raws: unknown[]): Promise<void> {
    const me = this.host.me().key
    let dirty = false
    const opened: Member[] = [] // members whose log we just opened (the creator will read their requests there)
    for (const raw of raws) {
      const entry = raw as Partial<{
        type: string
        name: string
        avatar: unknown
        imageTtl: unknown
        key: string
        core: string
        id: string
        kind: string
        ts: number
      }> | null
      const ts = Number.isFinite(entry?.ts) ? (entry!.ts as number) : 0

      if (entry?.type === 'meta') {
        if (cleanName(entry.name)) rt.saved.name = cleanName(entry.name)
        const avatar = cleanAvatar(entry.avatar)
        if (avatar !== undefined) rt.avatar = avatar
        if (entry.imageTtl === null) rt.imageTtl = undefined
        else if (Number.isInteger(entry.imageTtl) && (entry.imageTtl as number) >= 0 && (entry.imageTtl as number) <= MAX_TTL_HOURS)
          rt.imageTtl = entry.imageTtl as number
        dirty = true
      }

      if (entry?.type === 'channel') {
        const id = cleanChannelId(entry.id)
        const kind = entry.kind === 'voice' ? 'voice' : entry.kind === 'text' ? 'text' : null
        if (!id || !kind || !cleanName(entry.name) || rt.channels.size >= MAX_CHANNELS) continue
        rt.channels.set(id, { id, name: cleanName(entry.name), kind })
        dirty = true
      }

      if (entry?.type === 'channel-rename') {
        const channel = rt.channels.get(cleanChannelId(entry.id) ?? '')
        const name = channel ? this.channelName(channel.kind, entry.name) : ''
        if (!channel || !name) continue
        rt.channels.set(channel.id, { ...channel, name })
        dirty = true
      }

      if (entry?.type === 'channel-delete') {
        const id = cleanChannelId(entry.id)
        if (!id || id === GENERAL.id) continue
        dirty = rt.channels.delete(id) || dirty
      }

      // The creator deleted the room: it disappears from this device
      if (entry?.type === 'room-delete') {
        await this.forget(rt)
        return
      }

      if (entry?.type === 'member') {
        if (typeof entry.key !== 'string' || !HEX_KEY.test(entry.key)) continue
        if (typeof entry.core !== 'string' || !HEX_KEY.test(entry.core)) continue
        if (rt.members.size >= MAX_MEMBERS) continue
        const member = {
          key: entry.key,
          core: entry.core,
          name: cleanName(entry.name) || entry.key.slice(0, 8),
          since: ts
        }
        // The member whose log IS the room is the creator: we correct the identity announced in the invitation
        if (member.core === rt.saved.key) rt.saved.owner = member.key
        rt.members.set(member.key, member)
        rt.enrolling.delete(member.key)
        if (member.key === me && rt.saved.status === 'joining')
          rt.saved.status = 'joined' // we are signed up!
        else if (member.key !== me && member.core !== rt.saved.key) {
          await this.openMemberCore(rt, member)
          opened.push(member)
        }
        dirty = true
      }

      if (entry?.type === 'member-remove') {
        if (typeof entry.key !== 'string' || !HEX_KEY.test(entry.key) || entry.key === rt.saved.owner) continue
        rt.members.delete(entry.key)
        rt.cores.delete(entry.key) // their messages are no longer displayed
        rt.removedAt.set(entry.key, ts)
        if (entry.key === me) {
          // Removed (or I had left): the room disappears from my app
          this.dropRoom(rt)
          await this.persist()
          this.host.changed()
          return
        }
        dirty = true
      }
    }

    // The creator reads what members ask of them ('join' / 'leave'), including the old one
    if (rt.saved.owner === me) {
      for (const member of opened)
        await this.handleMemberEntries(rt, member.key, await readRaw(rt.cores.get(member.key)))
    }
    if (dirty) {
      await this.persist()
      this.host.changed()
    }
  }

  //& Requests from members to the creator, written in their own log
  // 'join': I invited a friend, sign them up · 'leave': I am leaving the room.
  private async handleMemberEntries(rt: RoomRuntime, author: string, raws: unknown[]): Promise<void> {
    if (rt.saved.owner !== this.host.me().key) return
    for (const raw of raws) {
      const e = raw as Partial<{ type: string; key: string; core: string; name: string; ts: number }> | null
      const ts = Number.isFinite(e?.ts) ? (e!.ts as number) : 0

      if (e?.type === 'leave') {
        const member = rt.members.get(author)
        // A request older than the sign-up (previous stay in the room) is ignored
        if (member && author !== rt.saved.owner && ts > member.since) await this.removeMember(rt, member, 'left')
      }

      if (e?.type === 'join' && rt.members.has(author)) {
        if (typeof e.key !== 'string' || !HEX_KEY.test(e.key)) continue
        if (typeof e.core !== 'string' || !HEX_KEY.test(e.core)) continue
        if (ts <= (rt.removedAt.get(e.key) ?? 0)) continue // request from before their removal
        await this.enroll(rt, { key: e.key, core: e.core, name: e.name })
      }
    }
  }

  // (creator) signs up a member in the registry, only once
  private async enroll(rt: RoomRuntime, who: { key: string; core: string; name?: string }): Promise<void> {
    if (rt.members.has(who.key) || rt.enrolling.has(who.key)) return
    if (rt.members.size + rt.enrolling.size >= MAX_MEMBERS) return
    rt.enrolling.add(who.key)
    rt.saved.pendingInvites = rt.saved.pendingInvites.filter((k) => k !== who.key)
    await this.persist()
    const name = cleanName(who.name) || this.host.displayName(who.key) || who.key.slice(0, 8)
    await rt.ownerCore.append({
      type: 'member',
      key: who.key,
      core: who.core,
      name,
      ts: Date.now()
    } satisfies JournalEntry)
  }

  private async removeMember(rt: RoomRuntime, member: Member, reason: 'left' | 'kicked'): Promise<void> {
    const name = this.host.displayName(member.key) ?? member.name
    await rt.ownerCore.append({
      type: 'member-remove',
      key: member.key,
      name,
      reason,
      ts: Date.now()
    } satisfies JournalEntry)
  }

  private async forget(rt: RoomRuntime): Promise<void> {
    if (!this.rooms.has(rt.saved.key)) return
    this.dropRoom(rt)
    await this.persist()
    this.host.changed()
  }

  // Forgets the room on this device (the data stays on disk, unreachable from the app)
  private dropRoom(rt: RoomRuntime): void {
    rt.active = false
    this.rooms.delete(rt.saved.key)
    this.host.swarm.leave(rt.ownerCore.discoveryKey)
  }

  private channelName(kind: ChannelKind, name: unknown): string {
    return kind === 'text' ? textChannelName(cleanName(name)) : cleanName(name).slice(0, 32)
  }

  private async openMemberCore(rt: RoomRuntime, member: Member): Promise<void> {
    if (rt.cores.has(member.key)) return
    const core = this.host.store.get({ key: b4a.from(member.core, 'hex'), valueEncoding: 'json' })
    rt.cores.set(member.key, core)
    await core.ready()
    core.download({ start: 0, end: -1 })
    watchJournal(core, async (from) => {
      await this.emitFrom(rt, core, member.key, from)
      await this.handleMemberEntries(rt, member.key, await readRaw(core, from)) // (creator) 'join' / 'leave'
    })
  }

  private async emitFrom(rt: RoomRuntime, core: any, author: string, from: number): Promise<void> {
    const raws = await readRaw(core, from)
    const messages: ChatMessage[] = []
    for (const raw of raws) {
      const msg = toMessage(raw, author)
      if (msg) messages.push(msg)
    }
    for (const msg of withoutDeleted(raws, messages, author)) this.post(rt, msg)
    for (const id of deletedIds(raws, author)) this.postDeleted(rt, id, author)
  }

  // A member deleted one of their messages: the windows hide it (same guards as post)
  private postDeleted(rt: RoomRuntime, id: string, author: string): void {
    if (this.rooms.get(rt.saved.key) !== rt || rt.saved.leaving) return
    if (author !== rt.saved.owner && !rt.members.has(author) && author !== this.host.me().key) return
    this.host.messageDeleted(rt.saved.key, id, author)
  }

  // Forwards a message to the windows, unless the room is left / forgotten or the author is no longer a member
  private post(rt: RoomRuntime, msg: ChatMessage): void {
    if (this.rooms.get(rt.saved.key) !== rt || rt.saved.leaving) return
    if (msg.from !== rt.saved.owner && !rt.members.has(msg.from) && msg.from !== this.host.me().key) return
    this.host.message(rt.saved.key, msg)
  }

  // Creator's log → normal messages + system messages ("X joined the room")
  private ownerEntriesToMessages(rt: RoomRuntime, raws: unknown[], start: number): ChatMessage[] {
    const messages: ChatMessage[] = []
    raws.forEach((raw, i) => {
      const msg = toMessage(raw, rt.saved.owner)
      if (msg) return void messages.push(msg)
      const entry = raw as Partial<{ type: string; name: string; kind: string; id: string; ts: number }> | null
      const ts = Number.isFinite(entry?.ts) ? (entry!.ts as number) : 0
      const id = `sys:${rt.saved.key.slice(0, 16)}:${start + i}` // stable: position in the log
      const system = (text: string, channel?: string): void =>
        void messages.push({ id, from: rt.saved.owner, text, ts, system: true, channel })

      if (entry?.type === 'member') system(t('sys.joined', { name: cleanName(entry.name) }))
      if (entry?.type === 'member-remove') {
        const kicked = (raw as { reason?: string }).reason === 'kicked'
        system(t(kicked ? 'sys.kicked' : 'sys.left', { name: cleanName(entry.name) }))
      }
      if (entry?.type === 'meta' && cleanName(entry.name)) {
        system(
          t(start + i === 0 ? 'sys.roomCreated' : 'sys.roomRenamed', { name: cleanName(entry.name) })
        )
      }
      // New text channel: announced in that channel itself (except 'general', already announced by the creation)
      if (entry?.type === 'channel' && entry.kind === 'text' && entry.id !== GENERAL.id) {
        system(t('sys.channelCreated', { name: cleanName(entry.name) }), cleanChannelId(entry.id))
      }
    })
    return messages
  }

  private sendInvite(rt: RoomRuntime, friendKey: string): void {
    this.host.sendControl(friendKey, {
      type: 'room-invite',
      room: rt.saved.key,
      name: rt.saved.name,
      owner: rt.saved.owner
    })
  }

  private sendJoin(rt: RoomRuntime): void {
    if (!rt.myCore) return
    // The reply goes to the person who invited me (the creator or another member)
    this.host.sendControl(rt.saved.inviter ?? rt.saved.owner, {
      type: 'room-join',
      room: rt.saved.key,
      core: hex(rt.myCore.key)
    })
  }

  private persist(): Promise<void> {
    return this.host.save([...this.rooms.values()].map((r) => r.saved))
  }
}
