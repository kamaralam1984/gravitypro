// trackingHealth.js — reads the OS and answers "is this phone actually
// reporting, and if not, why?"
//
// startBackgroundTracking() throws when a permission is missing and app/_layout
// only console.warn()s it. Nothing surfaced: the child saw a normal-looking app,
// the parent saw a bare "offline", and nobody could tell tracking had never
// started from the phone simply being off. This turns that silence into a
// specific, fixable reason.
//
// The OS reads live here; the decision they feed lives in trackingDiagnosis.js,
// which imports nothing so it can be tested outside Metro.
import { Platform } from 'react-native'
import * as Location from 'expo-location'
import { isBackgroundTrackingRunning, startBackgroundTracking } from './location'
import { diagnose, ISSUE } from './trackingDiagnosis'

export { ISSUE }

/**
 * @returns {Promise<{ok: boolean, issue: string|null, title?: string, message?: string, fixable?: boolean}>}
 * Never throws — a health check that breaks the screen it warns on is worse than
 * no health check.
 */
export const checkTrackingHealth = async () => {
  if (Platform.OS === 'web') return { ok: true, issue: null }

  try {
    const [servicesEnabled, fg, bg, taskRunning] = await Promise.all([
      Location.hasServicesEnabledAsync(),
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
      isBackgroundTrackingRunning(),
    ])
    return diagnose({
      servicesEnabled,
      foregroundGranted: fg?.status === 'granted',
      backgroundGranted: bg?.status === 'granted',
      taskRunning,
    })
  } catch (e) {
    // An unreadable state is not a reported problem: crying wolf here trains
    // people to ignore the banner, which costs more than the missed warning.
    console.warn('[trackingHealth] check failed:', e?.message)
    return { ok: true, issue: null }
  }
}

/**
 * Try to fix the issue in-app. Returns the health state afterwards, so callers
 * re-render on what actually happened rather than assuming success — a
 * "granted" from the OS dialog still has to survive the task starting.
 */
export const tryFixTracking = async (issue) => {
  try {
    if (issue === ISSUE.FOREGROUND_DENIED) {
      await Location.requestForegroundPermissionsAsync()
    } else if (issue === ISSUE.BACKGROUND_DENIED) {
      // Android will not show this dialog until foreground is granted, and it is
      // the OS's own screen — not something the app can skip past.
      await Location.requestBackgroundPermissionsAsync()
    }
    // Every fixable path ends the same way: the task has to be (re)started.
    // startBackgroundTracking no-ops when it is already registered.
    await startBackgroundTracking()
  } catch (e) {
    console.warn('[trackingHealth] fix attempt failed:', e?.message)
  }
  return checkTrackingHealth()
}
