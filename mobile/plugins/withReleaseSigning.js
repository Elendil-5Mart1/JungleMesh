//* Config plugin: sign the release builds with OUR upload key instead of the debug key
// The key and its passwords never enter the repository: Gradle reads them from the user's own
// gradle.properties (%USERPROFILE%\.gradle\gradle.properties), see manual.md › "Clé de signature":
//   JUNGLEMESH_UPLOAD_STORE_FILE=C:/path/to/junglemesh-release.jks   (forward slashes: "\" escapes in this file)
//   JUNGLEMESH_UPLOAD_KEY_ALIAS=junglemesh
// and the passwords from user environment variables (Gradle turns ORG_GRADLE_PROJECT_X into the property X):
//   ORG_GRADLE_PROJECT_JUNGLEMESH_UPLOAD_STORE_PASSWORD, ORG_GRADLE_PROJECT_JUNGLEMESH_UPLOAD_KEY_PASSWORD
// Without these properties the release build stays signed with the debug key (local tests), and
// Gradle says so: a debug-signed bundle is refused by the Play Console anyway.
const { withAppBuildGradle } = require('expo/config-plugins')

const MARK = '// withReleaseSigning'

const SIGNING = `
        ${MARK}: our upload key, if this machine has it (see plugins/withReleaseSigning.js)
        release {
            if (project.hasProperty('JUNGLEMESH_UPLOAD_STORE_FILE')) {
                storeFile file(JUNGLEMESH_UPLOAD_STORE_FILE)
                storePassword JUNGLEMESH_UPLOAD_STORE_PASSWORD
                keyAlias JUNGLEMESH_UPLOAD_KEY_ALIAS
                keyPassword JUNGLEMESH_UPLOAD_KEY_PASSWORD
            }
        }`

const USE = `${MARK}
            if (project.hasProperty('JUNGLEMESH_UPLOAD_STORE_FILE')) {
                signingConfig signingConfigs.release
            } else {
                logger.warn('JungleMesh: no upload key on this machine, the release build is signed with the DEBUG key')
                signingConfig signingConfigs.debug
            }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents
    if (gradle.includes(MARK)) return mod

    // 1. A "release" signing config next to the debug one
    const signingConfigs = gradle.indexOf('signingConfigs {')
    if (signingConfigs === -1) throw new Error('withReleaseSigning: no signingConfigs block in app/build.gradle')
    const open = signingConfigs + 'signingConfigs {'.length
    gradle = gradle.slice(0, open) + SIGNING + gradle.slice(open)

    // 2. The release build type uses it (the template points it at the debug key)
    const release = gradle.indexOf('release {', gradle.indexOf('buildTypes {'))
    const debugLine = gradle.indexOf('signingConfig signingConfigs.debug', release)
    if (release === -1 || debugLine === -1) throw new Error('withReleaseSigning: release build type not found')
    gradle = gradle.slice(0, debugLine) + USE + gradle.slice(debugLine + 'signingConfig signingConfigs.debug'.length)

    mod.modResults.contents = gradle
    return mod
  })
}
