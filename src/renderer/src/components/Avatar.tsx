//* Round avatar: image, or initials on a color derived from the key (like Discord)
// Optional: presence dot at the bottom right, and click to change the image.
import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { fileToAvatar } from '@/utils/image'
import { cleanError } from '@/utils/errors'

interface AvatarProps {
  src: string | null
  name: string
  seed?: string // (no longer used: all avatars without an image have the same background)
  size?: number
  status?: 'online' | 'offline' // shows the presence dot
  onChange?: (avatar: string | null) => Promise<void> // makes the avatar editable
}

// Without an image: a single letter, the first of the name (the background is the same for everyone, see _avatar.scss)
const initial = (name: string): string => name.trim().charAt(0).toUpperCase() || '?'

export const Avatar = ({ src, name, size = 32, status, onChange }: AvatarProps) => {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const pick = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // allows picking the same file again afterwards
    if (!file || !onChange) return
    try {
      await onChange(await fileToAvatar(file))
      setError('')
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const editable = Boolean(onChange)

  return (
    <span
      className={`avatar ${editable ? 'avatar--editable' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      title={error || (editable ? t('avatar.change') : name)}
      onClick={editable ? () => input.current?.click() : undefined}
    >
      {src ? (
        <img className="avatar__img" src={src} alt="" draggable={false} />
      ) : (
        <span className="avatar__initials">
          {initial(name)}
        </span>
      )}
      {status && <span className={`avatar__status ${status === 'online' ? 'avatar__status--online' : ''}`} />}
      {editable && (
        <>
          <span className="avatar__edit">✎</span>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
        </>
      )}
    </span>
  )
}
