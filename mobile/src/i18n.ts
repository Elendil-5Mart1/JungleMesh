//* Translations: the same i18next instance and texts as the desktop (src/shared)
import { initReactI18next } from 'react-i18next'
import { i18n, setupI18n } from '../../src/shared/i18n'

i18n.use(initReactI18next)

export const i18nReady = setupI18n()
