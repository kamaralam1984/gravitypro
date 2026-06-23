// Dev-only stub for expo-updates.
//
// The debug/dev build does not bundle the ExpoUpdates native module, and OTA
// updates are disabled in dev anyway (the only caller bails out early on
// `__DEV__ || !Updates.isEnabled`). Metro aliases `expo-updates` to this file
// for dev bundles (see metro.config.js) so the missing native module can never
// be referenced. Release builds resolve the real package normally.
export const isEnabled = false
export const channel = null
export const runtimeVersion = null
export const updateId = null
export async function checkForUpdateAsync() {
  return { isAvailable: false }
}
export async function fetchUpdateAsync() {
  return { isNew: false }
}
export async function reloadAsync() {}
export default { isEnabled, channel, runtimeVersion, updateId, checkForUpdateAsync, fetchUpdateAsync, reloadAsync }
