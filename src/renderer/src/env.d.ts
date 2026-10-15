/// <reference types="vite/client" />
import type { ChatApi } from '../../shared/types'

// Makes window.api known to TypeScript in all React views
declare global {
  interface Window {
    api: ChatApi
  }
}
