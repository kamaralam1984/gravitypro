const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

const WEB_STUBS = {
  'react-native-maps': __dirname + '/stubs/react-native-maps.web.js',
  'react-native-reanimated': __dirname + '/stubs/react-native-reanimated.web.js',
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return { filePath: WEB_STUBS[moduleName], type: 'sourceFile' }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
