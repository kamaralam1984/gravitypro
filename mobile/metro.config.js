const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

const WEB_STUBS = {
  'react-native-reanimated': __dirname + '/stubs/react-native-reanimated.web.js',
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return { filePath: WEB_STUBS[moduleName], type: 'sourceFile' }
  }
  // expo-updates (OTA) is not configured and its KSP step is incompatible with
  // this Kotlin toolchain, so it's removed from the native build. Stub it in JS
  // for ALL bundles (dev + release) so the import resolves to a harmless no-op.
  if (moduleName === 'expo-updates') {
    return { filePath: __dirname + '/stubs/expo-updates.js', type: 'sourceFile' }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
