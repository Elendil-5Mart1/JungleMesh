//* Syntax highlighting of code blocks (```js …), as on the desktop
// The desktop uses rehype-highlight, i.e. lowlight (highlight.js turned into a tree) with the "common" languages
// and only when the block names its language. Same library and same rules here; only the drawing changes:
// the tree's <span class="hljs-…"> become nested <Text> coloured like the desktop's github-dark theme.
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { common, createLowlight } from 'lowlight'
import type { ElementContent } from 'hast'

const lowlight = createLowlight(common)

// highlight.js class → colour (copied from highlight.js/styles/github-dark.css)
const COLORS: Record<string, string> = {
  'hljs-doctag': '#ff7b72',
  'hljs-keyword': '#ff7b72',
  'hljs-template-tag': '#ff7b72',
  'hljs-template-variable': '#ff7b72',
  'hljs-type': '#ff7b72',
  'hljs-title': '#d2a8ff',
  'hljs-attr': '#79c0ff',
  'hljs-attribute': '#79c0ff',
  'hljs-literal': '#79c0ff',
  'hljs-meta': '#79c0ff',
  'hljs-number': '#79c0ff',
  'hljs-operator': '#79c0ff',
  'hljs-variable': '#79c0ff',
  'hljs-selector-attr': '#79c0ff',
  'hljs-selector-class': '#79c0ff',
  'hljs-selector-id': '#79c0ff',
  'hljs-regexp': '#a5d6ff',
  'hljs-string': '#a5d6ff',
  'hljs-built_in': '#ffa657',
  'hljs-symbol': '#ffa657',
  'hljs-comment': '#8b949e',
  'hljs-code': '#8b949e',
  'hljs-formula': '#8b949e',
  'hljs-name': '#7ee787',
  'hljs-quote': '#7ee787',
  'hljs-selector-tag': '#7ee787',
  'hljs-selector-pseudo': '#7ee787',
  'hljs-section': '#1f6feb',
  'hljs-bullet': '#f2cc60',
  'hljs-addition': '#aff5b4',
  'hljs-deletion': '#ffdcd7'
}

// One node of the tree → text, or a coloured <Text> around its children (which inherit the colour)
const draw = (node: ElementContent, key: number): ReactNode => {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null
  const classes = Array.isArray(node.properties?.className) ? node.properties.className.map(String) : []
  const color = classes.map((c) => COLORS[c]).find(Boolean)
  return (
    <Text key={key} style={color ? { color } : undefined}>
      {node.children.map(draw)}
    </Text>
  )
}

// null = no language named, or one lowlight does not know: the block stays plain, as on the desktop
export const highlightCode = (lang: string | null | undefined, value: string): ReactNode => {
  if (!lang || !lowlight.registered(lang)) return null
  try {
    return lowlight.highlight(lang, value).children.map((node, i) => draw(node as ElementContent, i))
  } catch {
    return null // a grammar that chokes on odd input: never break the message
  }
}
