//* Config plugin: R8 keep rules for the calls (react-native-webrtc, react-native-incall-manager)
// The release build shrinks and renames the Java classes (R8, android.enableMinifyInReleaseBuilds).
// libwebrtc's C++ calls its Java classes BY NAME (JNI): renamed or removed, the app would crash at the
// first call. And R8 stops the build on a class referenced by the library but not shipped
// (org.webrtc.Dav1dDecoder$Natives, an optional AV1 decoder): -dontwarn.
// android/ is generated (expo prebuild): the rules are appended to proguard-rules.pro at each prebuild.
const fs = require('fs')
const path = require('path')
const { withDangerousMod } = require('expo/config-plugins')

const MARK = '# withWebRtcProguard'
const RULES = `
${MARK} (generated, see mobile/plugins/withWebRtcProguard.js)
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
-keep class com.oney.WebRTCModule.** { *; }
-keep class com.zxcpoiu.incallmanager.** { *; }
`

module.exports = function withWebRtcProguard(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, 'app/proguard-rules.pro')
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      if (!current.includes(MARK)) fs.writeFileSync(file, current + RULES)
      return mod
    }
  ])
}
