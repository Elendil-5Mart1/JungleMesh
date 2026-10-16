//* Emoji picker: categories + search, 100% local (data bundled, no network)
// Loaded on demand (React.lazy in Composer): the ~700 KB of data stays out of the startup path.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import data from 'emojibase-data/en/data.json'

const MAX_VERSION = 15 // newer emoji show as empty boxes on Windows 10/11 and older Linux fonts
const GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9] // group 2 = skin tone components, useless alone

interface Emoji {
  unicode: string
  label: string
  tags: string[]
  group: number
}

// Skin variants are left out (an emoji's `skins` field): the base emoji is enough for now
const ALL: Emoji[] = data
  .filter((e) => e.group !== undefined && GROUPS.includes(e.group) && e.version <= MAX_VERSION)
  .map((e) => ({ unicode: e.emoji, label: e.label, tags: e.tags ?? [], group: e.group! }))

interface EmojiPickerProps {
  onPick: (emoji: string) => void
}

const EmojiPicker = ({ onPick }: EmojiPickerProps) => {
  const { t } = useTranslation()
  const [group, setGroup] = useState(0)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL.filter((e) => e.group === group)
    return ALL.filter((e) => e.label.includes(q) || e.tags.some((tag) => tag.includes(q))).slice(0, 200)
  }, [group, query])

  return (
    <div className="emoji">
      <input
        className="emoji__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('emoji.search')}
        autoFocus
      />
      {!query && (
        <div className="emoji__tabs">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              className={`emoji__tab ${g === group ? 'emoji__tab--active' : ''}`}
              title={t(`emoji.group${g}`)}
              onClick={() => setGroup(g)}
            >
              {ALL.find((e) => e.group === g)?.unicode}
            </button>
          ))}
        </div>
      )}
      <div className="emoji__grid">
        {shown.map((e) => (
          <button key={e.unicode} type="button" className="emoji__item" title={e.label} onClick={() => onPick(e.unicode)}>
            {e.unicode}
          </button>
        ))}
        {shown.length === 0 && <p className="emoji__none">{t('emoji.none')}</p>}
      </div>
    </div>
  )
}

export default EmojiPicker
