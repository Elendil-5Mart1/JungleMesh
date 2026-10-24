//* Private conversation window with a friend
import { useEffect, useRef, useState } from 'react'
import { useCoreStore } from '@/stores/useCoreStore'
import { MessageList, type Author } from '@/components/MessageList'
import { Composer } from '@/components/Composer'
import { CallBar } from '@/components/CallBar'
import { CallStage, type StageMember } from '@/components/CallStage'
import { CallControls } from '@/components/CallControls'
import { sendMessage } from '@/utils/sendMessage'
import { useVoice } from '@/voice/useVoice'
import { useVideoStats, statLines } from '@/voice/useVideoStats'
import { screenTiles } from '@/voice/screenTiles'
import { getVoiceVolume, saveVoiceVolume } from '@/utils/voiceVolume'
import { useTranslation } from 'react-i18next'
import { cleanError } from '@/utils/errors'
import { startRing } from '@/utils/notifSound'

const EMPTY: never[] = [] // stable reference: avoids an infinite re-render with Zustand

export const ChatView = ({ friendKey }: { friendKey: string }) => {
  const { t } = useTranslation()
  const me = useCoreStore((s) => s.me)
  const friend = useCoreStore((s) => s.friends?.find((f) => f.key === friendKey))
  const messages = useCoreStore((s) => s.messages[friendKey] ?? EMPTY)
  const settings = useCoreStore((s) => s.settings)
  const loadHistory = useCoreStore((s) => s.loadHistory)

  const [error, setError] = useState('')
  // 1-to-1 call: same machinery as the voice channels, with the "virtual room" shared with this friend
  const voice = useVoice(friend?.callId ?? '', me?.publicKey, friend ? { dm: friend.call } : undefined)
  const [showStats, setShowStats] = useState(false) // video diagnostic on the friend's tile
  const videoStats = useVideoStats(voice.session, showStats && voice.activeChan === 'dm')
  const [volume, setVolume] = useState(() => getVoiceVolume(friendKey)) // listening volume of the friend
  const live = voice.activeChan === 'dm' && voice.status?.phase === 'live'

  // On load: we fetch the history already received by the core
  useEffect(() => {
    void loadHistory(friendKey)
  }, [friendKey, loadHistory])

  // I am calling and the friend has not answered yet: waiting tone, like a phone
  const waiting = voice.activeChan === 'dm' && !!friend && !friend.call.includes(friend.key)
  const ringOn = waiting && (settings?.ringtone ?? true)
  useEffect(() => {
    if (!ringOn) return
    return startRing('outgoing', useCoreStore.getState().settings)
  }, [ringOn])

  // "Join" clicked in the incoming call popup: we join as soon as the friend and my key are known
  const [autoJoin, setAutoJoin] = useState(false)
  useEffect(() => {
    void window.api.callTakeAutoJoin(friendKey).then((yes) => yes && setAutoJoin(true))
    return window.api.onCallAutoJoin(() => setAutoJoin(true))
  }, [friendKey])
  useEffect(() => {
    if (!autoJoin || !friend || !me) return
    setAutoJoin(false)
    if (voice.activeChan !== 'dm') void voice.join('dm')
  }, [autoJoin, friend, me])

  // The friend refused my call: we hang up (end of the waiting tone). The "X declined the call"
  // line arrives in the conversation by itself (written in their log).
  const leaveRef = useRef(voice.leave)
  leaveRef.current = voice.leave
  useEffect(() => window.api.onCallDeclined(() => leaveRef.current()), [])

  // The window title (Windows bar) follows the friend's name
  useEffect(() => {
    if (friend) document.title = friend.name
  }, [friend?.name])

  const send = async (text: string, files: File[]): Promise<void> => {
    try {
      await sendMessage(friendKey, text, files)
      setError('')
    } catch (err) {
      setError(cleanError(err))
      throw err // the Composer then keeps the typed text
    }
  }

  const remove = (id: string): void => {
    void window.api.deleteMessage(friendKey, id).catch((err) => setError(cleanError(err)))
  }
  const editMessage = (id: string, text: string): void => {
    void window.api.editMessage(friendKey, id, text).catch((err) => setError(cleanError(err)))
  }
  const react = (id: string, to: string, emoji: string, on: boolean): void => {
    void window.api.react(friendKey, id, to, emoji, on).catch((err) => setError(cleanError(err)))
  }

  const changeVolume = (value: number): void => {
    setVolume(value)
    saveVoiceVolume(friendKey, value)
    voice.session.current?.setVolume(friendKey, value)
  }

  // Author of a message: me or the friend (name + avatar)
  const author = (from: string): Author =>
    from === me?.publicKey
      ? { name: me.name, avatar: me.avatar }
      : { name: friend?.name ?? '?', avatar: friend?.avatar ?? null }

  // Participants shown in the stage: the friend (once they are in the call), then me
  const stage: StageMember[] = []
  if (live && friend && me) {
    const status = voice.status!
    if (friend.call.includes(friend.key)) {
      const link = status.links[friend.key] ?? 'connecting'
      stage.push({
        key: friend.key,
        name: friend.name,
        avatar: friend.avatar,
        video: status.videos[friend.key],
        speaking: status.speaking.includes(friend.key),
        note: link === 'connected' ? undefined : t(`room.link.${link}`),
        noteKind: link,
        stats: showStats ? statLines(videoStats[friend.key]) : undefined
      })
    }
    stage.push({
      key: me.publicKey,
      name: me.name,
      avatar: me.avatar,
      video: status.localVideo,
      mirror: settings?.mirrorCamera ?? true,
      speaking: status.speaking.includes(me.publicKey)
    })
    // Shared screens: after the people
    stage.push(...screenTiles(voice, [friend, { key: me.publicKey, name: me.name, avatar: me.avatar }], me.publicKey, showStats ? videoStats : undefined))
  }

  return (
    <div className="chat">
      {/* Call in progress: participants (bubbles or videos) + buttons, above the conversation */}
      {live && (
        <CallStage members={stage}>
          <CallControls
            voice={voice}
            showStats={showStats}
            onToggleStats={() => setShowStats((on) => !on)}
            before={
              <input
                className="callbar__volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                title={t('menu.volume', { percent: Math.round(volume * 100) })}
                onChange={(e) => changeVolume(Number(e.target.value))}
              />
            }
          />
        </CallStage>
      )}
      <MessageList
        messages={messages}
        myKey={me?.publicKey}
        author={author}
        imageTtlHours={settings?.imageTtlHours}
        onDelete={remove}
        onEdit={editMessage}
        onReact={react}
      />

      {error && <p className="chat__error">{error}</p>}
      <Composer
        disabled={!friend}
        placeholder={
          friend?.online
            ? t('chat.sendTo', { name: friend.name })
            : t('chat.offline', { name: friend?.name ?? t('chat.friend') })
        }
        onSend={send}
        attachable
      />
      {friend && me && <CallBar friend={friend} voice={voice} />}
    </div>
  )
}
