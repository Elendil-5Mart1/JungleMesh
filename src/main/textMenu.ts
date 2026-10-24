//* Right click on text: cut / copy / paste / select all, with the spelling suggestions
// Native Electron menu: the roles (copy, paste…) go through Chromium, so pasting works even though the page
// is not allowed to READ the clipboard. Elements with our own menu (members, friends, messages) call
// preventDefault on their contextmenu event: Electron does not emit 'context-menu' for them.
import { Menu, session, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../shared/i18n'

// Spelling: Chromium's spellchecker (the Windows one under Windows, Hunspell elsewhere).
// French and English, among the languages actually available on this machine.
const WANTED_LANGUAGES = ['fr', 'fr-FR', 'fr-BE', 'en-US', 'en-GB']
export const setupSpellcheck = (): void => {
  const ses = session.defaultSession
  const available = ses.availableSpellCheckerLanguages
  const languages = WANTED_LANGUAGES.filter((l) => available.includes(l))
  if (languages.length > 0) ses.setSpellCheckerLanguages(languages)
}

export const attachTextMenu = (win: BrowserWindow): void => {
  win.webContents.on('context-menu', (_e, params) => {
    const { isEditable, selectionText, misspelledWord, dictionarySuggestions, editFlags } = params
    const hasSelection = selectionText.trim().length > 0
    if (!isEditable && !hasSelection) return // right click on nothing in particular: no menu

    const items: MenuItemConstructorOptions[] = []
    // Misspelled word: suggestions first, then "add to dictionary"
    if (isEditable && misspelledWord) {
      for (const word of dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) })
      }
      if (dictionarySuggestions.length === 0) items.push({ label: t('textMenu.noSuggestion'), enabled: false })
      items.push({
        label: t('textMenu.addWord'),
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord)
      })
      items.push({ type: 'separator' })
    }
    if (isEditable) items.push({ role: 'cut', label: t('textMenu.cut'), enabled: editFlags.canCut && hasSelection })
    items.push({ role: 'copy', label: t('textMenu.copy'), enabled: editFlags.canCopy && hasSelection })
    if (isEditable) items.push({ role: 'paste', label: t('textMenu.paste'), enabled: editFlags.canPaste })
    items.push({ type: 'separator' }, { role: 'selectAll', label: t('textMenu.selectAll') })

    Menu.buildFromTemplate(items).popup({ window: win })
  })
}
