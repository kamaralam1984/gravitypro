import { Alert, Linking, Platform } from 'react-native'
import Constants from 'expo-constants'
import axios from 'axios'

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'
const CURRENT_VERSION_CODE = Number(Constants.expoConfig?.android?.versionCode || 1)

function isNewer(serverCode) {
  return Number(serverCode) > CURRENT_VERSION_CODE
}

// Called on app launch — silent check, shows banner if update available
export async function checkForUpdate() {
  if (Platform.OS === 'web') return null
  try {
    const { data } = await axios.get(`${API_URL}/api/v1/app/version`, { timeout: 8000 })
    if (data?.versionCode && isNewer(data.versionCode)) {
      return data  // { version, versionCode, downloadUrl, releaseNotes, forceUpdate }
    }
    return null
  } catch {
    return null  // network error — ignore silently
  }
}

// Open browser to download new APK
export function downloadUpdate(url) {
  Linking.openURL(url)
}

// Show full update dialog
export async function promptAndUpdate() {
  if (Platform.OS === 'web') return
  try {
    const { data } = await axios.get(`${API_URL}/api/v1/app/version`, { timeout: 8000 })
    if (!data?.versionCode) {
      Alert.alert('Up to date', 'You have the latest version of Gravity ✓')
      return
    }
    if (!isNewer(data.versionCode)) {
      Alert.alert('Up to date', `You have the latest version (${data.version}) ✓`)
      return
    }
    Alert.alert(
      '🆕 Update Available',
      `Version ${data.version} is ready.\n\n${data.releaseNotes || 'Improvements and bug fixes.'}`,
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Download Now',
          onPress: () => Linking.openURL(data.downloadUrl),
        },
      ]
    )
  } catch {
    Alert.alert('Check failed', 'Could not check for updates. Please try again later.')
  }
}
