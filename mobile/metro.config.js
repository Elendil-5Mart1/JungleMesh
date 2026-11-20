//* Metro (the React Native bundler) configuration
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const withBareKit = require('expo-bare-kit/metro')

const mobile = __dirname
const shared = path.resolve(mobile, '../src/shared')

const config = getDefaultConfig(mobile)

// The UI shares its types and texts with the desktop app (../src/shared)
config.watchFolders = [shared]

// A package imported from src/shared (i18next…) must come from mobile/node_modules,
// not from the desktop's: two copies of i18next = untranslated UI (bug already met on desktop).
const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest
  const isPackage = !moduleName.startsWith('.') && !path.isAbsolute(moduleName)
  if (isPackage && context.originModulePath.startsWith(shared + path.sep)) {
    return resolve({ ...context, originModulePath: path.join(mobile, 'package.json') }, moduleName, platform)
  }
  return resolve(context, moduleName, platform)
}

// expo-bare-kit packs the Bare worker (worker/index.js) every time Metro starts
module.exports = withBareKit(config)
