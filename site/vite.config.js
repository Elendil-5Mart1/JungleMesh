//* Landing page build (GitHub Pages)
// base './': the site is served from https://<user>.github.io/JungleMesh/, not from the domain root
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  // The SCSS reuses the app's variables (../src/renderer/src/styles), outside this folder
  server: { fs: { allow: ['..'] } }
})
