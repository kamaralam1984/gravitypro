import * as Updates from 'expo-updates'

// Check for an over-the-air JS update and, if one is available, fetch + apply it
// by reloading the app. Returns true if an update was applied (the app reloads,
// so code after this won't run in that case). Safe no-op in dev / Expo Go.
export const checkAndApplyOTA = async () => {
  if (__DEV__ || !Updates.isEnabled) return false
  try {
    const res = await Updates.checkForUpdateAsync()
    if (res.isAvailable) {
      await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()
      return true
    }
  } catch {
    // offline / no update / native module missing — ignore
  }
  return false
}
