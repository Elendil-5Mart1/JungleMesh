//* Markdown rendering of a message, mobile version
// Same parser as the desktop (remark = mdast-util-from-markdown + GFM: tables, ~~strike~~,
// task lists, autolinks), so a message is interpreted the same way on both sides.
// Only the drawing is ours: each node of the tree becomes React Native components.
// Rule of React Native: a <View> (block) cannot live inside a <Text> (line of text), so
// "blocks" (paragraph, list, quote, code…) are Views and "inline" nodes (bold, link…) nested Texts.
import { memo, useMemo, useState, type ReactNode } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { PhrasingContent, RootContent } from 'mdast'
import { colors, fonts, radius, space } from '../theme'

type Base = StyleProp<TextStyle> // text style of the message, inherited by every block

// Links open in the browser, but only the usual protocols (no javascript:, intent:, file:…)
const openLink = (url: string) => {
  if (/^(https?|mailto):/i.test(url)) void Linking.openURL(url)
}

//& Code block with a "Copy" button
const CodeBlock = ({ value }: { value: string }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await Clipboard.setStringAsync(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <View style={styles.pre}>
      {/* Long lines scroll sideways instead of wrapping (like the desktop) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.preText} selectable>
          {value}
        </Text>
      </ScrollView>
      <Pressable onPress={copy} style={styles.copy} hitSlop={6}>
        <Text style={styles.copyText}>{copied ? t('settings.copied') : t('settings.copy')}</Text>
      </Pressable>
    </View>
  )
}

//& Inline nodes → nested <Text> (they inherit the style of the paragraph around them)
const inline = (nodes: PhrasingContent[]): ReactNode[] => nodes.map(inlineNode)

const inlineNode = (node: PhrasingContent, key: number): ReactNode => {
  switch (node.type) {
    case 'text':
      return node.value // a plain "\n" already breaks the line (= remark-breaks on the desktop)
    case 'strong':
      return <Text key={key} style={styles.strong}>{inline(node.children)}</Text>
    case 'emphasis':
      return <Text key={key} style={styles.em}>{inline(node.children)}</Text>
    case 'delete':
      return <Text key={key} style={styles.del}>{inline(node.children)}</Text>
    case 'inlineCode':
      return <Text key={key} style={styles.code}>{node.value}</Text>
    case 'break':
      return '\n'
    case 'link':
      return (
        <Text key={key} style={styles.link} onPress={() => openLink(node.url)}>
          {inline(node.children)}
        </Text>
      )
    // Images: never loaded automatically. Loading a remote image would reveal
    // your IP address to whoever hosts it (classic tracker). A link instead, as on the desktop.
    case 'image':
      return (
        <Text key={key} style={styles.link} onPress={() => openLink(node.url)}>
          🖼 {node.alt || 'image'}
        </Text>
      )
    // [text][ref] whose definition is elsewhere: rare in a chat, the text is enough
    case 'linkReference':
      return <Text key={key}>{inline(node.children)}</Text>
    case 'imageReference':
      return `🖼 ${node.alt || 'image'}`
    case 'footnoteReference':
      return `[${node.label ?? node.identifier}]`
    // Raw HTML is NEVER interpreted: shown as typed (same rule as the desktop)
    case 'html':
      return node.value
    default:
      return null
  }
}

//& Blocks → <View> / paragraph <Text>
const blocks = (nodes: RootContent[], base: Base): ReactNode[] => nodes.map((n, i) => block(n, i, base))

const block = (node: RootContent, key: number, base: Base): ReactNode => {
  switch (node.type) {
    case 'paragraph':
      return (
        <Text key={key} style={base} selectable>
          {inline(node.children)}
        </Text>
      )
    case 'heading':
      return (
        <Text key={key} style={[base, styles.heading, headingSize[node.depth]]} selectable>
          {inline(node.children)}
        </Text>
      )
    case 'blockquote':
      return (
        <View key={key} style={styles.quote}>
          {blocks(node.children, base)}
        </View>
      )
    case 'list':
      return (
        <View key={key} style={styles.blocks}>
          {node.children.map((item, i) => {
            // Task list "- [x]" (checked true/false), numbered list, or bullet
            const marker =
              item.checked === true ? '☑' : item.checked === false ? '☐' : node.ordered ? `${(node.start ?? 1) + i}.` : '•'
            return (
              <View key={i} style={styles.item}>
                <Text style={[base, styles.marker]}>{marker}</Text>
                <View style={[styles.blocks, styles.itemBody]}>{blocks(item.children, base)}</View>
              </View>
            )
          })}
        </View>
      )
    case 'code':
      return <CodeBlock key={key} value={node.value} />
    case 'thematicBreak':
      return <View key={key} style={styles.hr} />
    case 'table':
      return (
        <View key={key} style={styles.table}>
          {node.children.map((row, r) => (
            <View key={r} style={[styles.row, r === 0 && styles.headRow]}>
              {row.children.map((cell, c) => (
                <Text key={c} style={[base, styles.cell, r === 0 && styles.strong]}>
                  {inline(cell.children)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )
    case 'footnoteDefinition':
      return (
        <View key={key} style={styles.item}>
          <Text style={[base, styles.marker]}>[{node.label ?? node.identifier}]</Text>
          <View style={[styles.blocks, styles.itemBody]}>{blocks(node.children, base)}</View>
        </View>
      )
    case 'html':
      return (
        <Text key={key} style={base} selectable>
          {node.value}
        </Text>
      )
    default:
      return null // definitions ([ref]: url) and the like: nothing to draw
  }
}

//& Component
// memo: parsing is the most expensive part of a message; it is only redone when the text changes
// (not when the list re-renders for a new message below)
export const Markdown = memo(({ text, style }: { text: string; style?: Base }) => {
  const tree = useMemo(
    () => fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }),
    [text]
  )
  return <View style={styles.blocks}>{blocks(tree.children, style)}</View>
})

//& Styles
const headingSize: Record<number, TextStyle> = {
  1: { fontSize: 22, lineHeight: 28 },
  2: { fontSize: 19, lineHeight: 25 },
  3: { fontSize: 17, lineHeight: 23 }
}

const styles = StyleSheet.create({
  blocks: { gap: space / 2 },
  strong: { fontWeight: 'bold' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  code: { fontFamily: fonts.mono, backgroundColor: colors.bgDeep, color: colors.warn, fontSize: 13 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  heading: { fontWeight: 'bold' },

  quote: { borderLeftColor: colors.border, borderLeftWidth: 3, paddingLeft: space, gap: space / 2 },
  item: { flexDirection: 'row', gap: space / 2 },
  marker: { minWidth: 16 },
  itemBody: { flex: 1 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: space / 2 },

  pre: {
    backgroundColor: colors.bgDeep,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius,
    padding: space,
    paddingTop: space * 3 // room for the "Copy" button
  },
  preText: { fontFamily: fonts.mono, color: colors.text, fontSize: 13, lineHeight: 18 },
  copy: { position: 'absolute', top: space / 2, right: space },
  copyText: { color: colors.textMuted, fontSize: 12 },

  table: { borderColor: colors.border, borderWidth: 1, borderRadius: radius },
  row: { flexDirection: 'row', borderTopColor: colors.line, borderTopWidth: 1 },
  headRow: { borderTopWidth: 0, backgroundColor: colors.bgSoft },
  cell: { flex: 1, paddingHorizontal: space / 2, paddingVertical: 2 }
})
