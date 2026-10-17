//* Markdown rendering of a message, Discord-style (colored code, lists, tables…)
import { memo, useState, type ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import 'highlight.js/styles/github-dark.css'

//& Code block with a "Copy" button
const CodeBlock = ({ children, ...props }: ComponentProps<'pre'>) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async (e: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    // We take the plain text of the <pre> (without the highlighting tags)
    const text = e.currentTarget.parentElement?.querySelector('code')?.innerText ?? ''
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <pre className="md__pre" {...props}>
      <button type="button" className="md__copy" onClick={copy}>
        {copied ? t('settings.copied') : t('settings.copy')}
      </button>
      {children}
    </pre>
  )
}

//& Tag replacements
const components: Components = {
  pre: CodeBlock,
  // Links: always opened in the external browser (handled by the main process)
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // Images: never loaded automatically. Loading a remote image would reveal
  // your IP address to whoever hosts it (classic tracker). We show a link instead.
  img: ({ src, alt }) => (
    <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer">
      <Icon name="image" size={16} className="md__img-icon" /> {alt || 'image'}
    </a>
  )
}

const REMARK = [remarkGfm, remarkBreaks]
const REHYPE = [rehypeHighlight]

// memo: parsing + highlighting is the most expensive part of a message; it is only redone when the text changes
// (not when the window re-renders for a call, a splitter drag, a new message below…)
export const Markdown = memo(({ text }: { text: string }) => (
  <div className="md">
    {/* react-markdown does NOT interpret raw HTML by default: a message
        containing <script> or <img onerror> is displayed as text. We keep it that way. */}
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
      {text}
    </ReactMarkdown>
  </div>
))
