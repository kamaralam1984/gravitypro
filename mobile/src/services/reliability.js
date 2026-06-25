// reliability.js
// Best-effort helpers to keep Gravity's background location tracking alive on
// aggressive Android OEMs (Xiaomi/MIUI, Oppo/ColorOS, Vivo/FuntouchOS, Realme,
// Huawei/EMUI, Samsung). These open *system settings screens* for the user to
// confirm — Android does NOT allow an app to silently whitelist itself for
// battery optimisation or auto-start, so every function here is a guided prompt.
//
// IMPORTANT: OEM auto-start CANNOT be fully automated. The best any app can do
// is deep-link to the relevant settings page; the user must toggle it manually.
// Every call is wrapped in try/catch and falls back to the app-details screen so
// an unsupported OEM never crashes the app.

import { Platform } from 'react-native'

const APP_PACKAGE = 'com.trackalways.gravity'

// Lazy require so web / unsupported builds don't hard-crash on import.
const getIntentLauncher = () => {
  try {
    return require('expo-intent-launcher')
  } catch {
    return null
  }
}

const getDevice = () => {
  try {
    return require('expo-device')
  } catch {
    return null
  }
}

// Open this app's "App info / details" page — the universal safe fallback.
const openAppDetails = async () => {
  const IntentLauncher = getIntentLauncher()
  if (!IntentLauncher) return false
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: 'package:' + APP_PACKAGE }
    )
    return true
  } catch (e) {
    console.warn('[reliability] openAppDetails failed:', e?.message)
    return false
  }
}

// Try a list of explicit OEM component intents in order; return on first success.
const tryComponentIntents = async (intents) => {
  const IntentLauncher = getIntentLauncher()
  if (!IntentLauncher) return false
  for (const intent of intents) {
    try {
      // ACTION_MAIN ('android.intent.action.MAIN') + explicit package/className.
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: intent.packageName,
        className: intent.className,
      })
      return true
    } catch {
      // try next candidate
    }
  }
  return false
}

// ── 1. Ask the OS to ignore battery optimisation for this app ─────────────────
// Opens the system "ignore battery optimizations" request / settings screen.
// Returns true if *some* settings screen was opened.
export const requestIgnoreBatteryOptimizations = async () => {
  if (Platform.OS !== 'android') return false
  const IntentLauncher = getIntentLauncher()
  if (!IntentLauncher) return false

  // Preferred: direct "request ignore battery optimizations" dialog.
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: 'package:' + APP_PACKAGE }
    )
    return true
  } catch (e) {
    console.warn('[reliability] REQUEST_IGNORE_BATTERY_OPTIMIZATIONS failed:', e?.message)
  }

  // Fallback: the full battery-optimization settings list.
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'
    )
    return true
  } catch (e) {
    console.warn('[reliability] IGNORE_BATTERY_OPTIMIZATION_SETTINGS failed:', e?.message)
  }

  // Last resort: app details.
  return openAppDetails()
}

// ── 2. Open the OEM "auto-start / background launch" manager (best effort) ─────
// CANNOT be automated — only opens the screen for the user to toggle.
export const openAutoStartSettings = async () => {
  if (Platform.OS !== 'android') return false

  const Device = getDevice()
  const brand = (Device?.brand || Device?.manufacturer || '').toLowerCase()

  // OEM-specific auto-start manager components. These class names drift between
  // OS versions, so we list several per brand and fall through to app details.
  const xiaomi = [
    { packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
    { packageName: 'com.miui.securitycenter', className: 'com.miui.powercenter.PowerSettings' },
  ]
  const oppo = [
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
    { packageName: 'com.oppo.safe', className: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
  ]
  const vivo = [
    { packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
    { packageName: 'com.iqoo.secure', className: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' },
    { packageName: 'com.iqoo.secure', className: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' },
  ]
  const realme = [
    // Realme runs ColorOS — reuse Oppo components.
    ...oppo,
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.privacypermissionsentry.PermissionTopActivity' },
  ]
  const huawei = [
    { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
    { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
    { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity' },
  ]

  let candidates = []
  if (brand.includes('xiaomi') || brand.includes('redmi') || brand.includes('poco')) candidates = xiaomi
  else if (brand.includes('realme')) candidates = realme
  else if (brand.includes('oppo')) candidates = oppo
  else if (brand.includes('vivo') || brand.includes('iqoo')) candidates = vivo
  else if (brand.includes('huawei') || brand.includes('honor')) candidates = huawei

  try {
    if (candidates.length) {
      const ok = await tryComponentIntents(candidates)
      if (ok) return true
    }
  } catch (e) {
    console.warn('[reliability] openAutoStartSettings failed:', e?.message)
  }

  // Unknown OEM or all components failed → app details (always available).
  return openAppDetails()
}

// ── 3. Run the reliability prompts once ───────────────────────────────────────
// Call after login or from a "Improve tracking reliability" Settings button.
// Sequences battery-optimization first, then auto-start. Never throws.
export const ensureReliableTracking = async () => {
  if (Platform.OS !== 'android') return { battery: false, autoStart: false }
  let battery = false
  let autoStart = false
  try {
    battery = await requestIgnoreBatteryOptimizations()
  } catch (e) {
    console.warn('[reliability] battery step failed:', e?.message)
  }
  try {
    autoStart = await openAutoStartSettings()
  } catch (e) {
    console.warn('[reliability] auto-start step failed:', e?.message)
  }
  return { battery, autoStart }
}
