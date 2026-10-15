//* Translations (i18next): English is the reference language, French will come as a 2nd file
// The same module serves the main process (tray, notifications, errors) and the UI:
// each process creates its own instance by calling `setupI18n()` at startup.
import i18next, { type TOptions } from 'i18next'
import { en } from './locales/en'

export const i18n = i18next.createInstance()

export const setupI18n = (): Promise<unknown> =>
  i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false }, // React already escapes; in main we do not display HTML
    returnNull: false
  })

// Translation outside a React component (main process, utilities)
export const t = (key: string, options?: TOptions): string => i18n.t(key, options) as string
