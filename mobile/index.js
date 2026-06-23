import { registerRootComponent } from 'expo'
import { LogBox } from 'react-native'
import RootLayout from './app/_layout'

// Suppress the in-dev LogBox toast overlay (it has no effect in production builds).
LogBox.ignoreAllLogs(true)

registerRootComponent(RootLayout)
