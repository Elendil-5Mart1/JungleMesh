//* Worker entry point packed by expo-bare-kit (see app.json)
// The real code is TypeScript (core.ts), compiled to build/core.js by scripts/build-worker.mjs:
// bare-stow only reads JavaScript, and must find a CommonJS `module.exports = start`.
module.exports = require('./build/core.js').start
