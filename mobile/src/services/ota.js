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

// Check + download an update but DO NOT reload now. Expo applies a downloaded
// update on the next natural app restart, so this is safe to call when the app
// is already in use (no jarring mid-interaction reload). Returns true if an
// update was downloaded and is pending.
export const checkAndFetchOTA = async () => {
  if (__DEV__ || !Updates.isEnabled) return false
  try {
    const res = await Updates.checkForUpdateAsync()
    if (res.isAvailable) {
      await Updates.fetchUpdateAsync()
      return true
    }
  } catch {
    // ignore
  }
  return false
}
