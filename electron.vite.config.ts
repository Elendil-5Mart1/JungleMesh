//* electron-vite config: one build per Electron "process"
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  //& Main process (Node): P2P core + window management
  // Dependencies (hyperswarm…) stay in node_modules instead of being bundled:
  // they contain native modules (sodium, udx) that cannot be packaged.
  main: {
    build: { externalizeDeps: true }
  },

  //& Preload: the secure bridge between Node and the windows
  preload: {
    build: { externalizeDeps: true }
  },

  //& Renderer: the React UI (a single app, several "views" depending on the window)
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
      dedupe: ['react', 'react-dom'] // a single copy of React, no matter what
    },
    // Dependencies pre-optimized at startup: otherwise Vite discovers them along the way,
    // reloads the page, and may mix two copies of React
    // ("Invalid hook call" on first launch).
    optimizeDeps: {
      include: [
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        'zustand',
        'react-markdown',
        'remark-gfm',
        'remark-breaks',
        'rehype-highlight'
      ]
    },
    plugins: [react()]
  }
})
