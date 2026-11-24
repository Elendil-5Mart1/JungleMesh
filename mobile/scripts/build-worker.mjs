//* Compiles the Bare worker (worker/core.ts + the desktop core it imports) to worker/build/core.js
// Usage: node scripts/build-worker.mjs [--watch]
//
// - Our TypeScript (worker, src/main/p2p, src/shared) is bundled into ONE file,
//   so bare-stow never has to read files outside the mobile project.
// - npm packages (hyperswarm, corestore…) stay as require() calls: bare-stow resolves
//   them from mobile/node_modules, with their native addons for Android.
// - node:* modules do not exist in Bare: they are swapped for their bare-* equivalents.
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const BARE = {
  'node:events': 'bare-events',
  'node:fs': 'bare-fs',
  'node:fs/promises': 'bare-fs/promises',
  'node:path': 'bare-path',
  'node:crypto': 'bare-crypto'
}

// Rewrites node:* imports and fails loudly on one that has no Bare equivalent yet
const bareModules = {
  name: 'bare-modules',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, ({ path, importer }) => {
      if (BARE[path]) return { path: BARE[path], external: true }
      return { errors: [{ text: `${path} (imported by ${importer}) has no Bare equivalent in scripts/build-worker.mjs` }] }
    })
  }
}

// Pure-JS packages bundled INTO core.js instead of being left to bare-stow: @noble/hashes is ESM only
// (scrypt for the identity backup, see worker/core.ts), esbuild turns it into CommonJS with the rest.
const BUNDLED = /^@noble\/hashes\//
const bundledPackages = {
  name: 'bundled-packages',
  setup(build) {
    build.onResolve({ filter: BUNDLED }, ({ path }) => ({ path: fileURLToPath(import.meta.resolve(path)) }))
  }
}

const options = {
  entryPoints: [`${root}worker/core.ts`],
  outfile: `${root}worker/build/core.js`,
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2022',
  packages: 'external',
  plugins: [bundledPackages, bareModules],
  logLevel: 'info'
}

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
} else {
  await esbuild.build(options)
}
