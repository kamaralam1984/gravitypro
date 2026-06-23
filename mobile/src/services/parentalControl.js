// ── Child-device parental-control bridge ───────────────────────────────────────
//
// These helpers run on the CHILD device. They talk to a NATIVE module that is
// provided by the GravityPro config plugin (built separately — not an npm dep):
//
//   - GravityUsage   : reads Android UsageStats (requires native Usage Access
//                      permission granted by the user on the device).
//   - GravityBlocker : reports installed apps + applies the blocked-app list.
//
// On devices WITHOUT the native build (Expo Go, iOS, dev client without the
// plugin) the native modules are absent. Every function below degrades to a
// safe no-op with a console.warn so the JS bundle never crashes.

import { NativeModules } from 'react-native'
import { parentalAPI } from './api'

// Resolve native modules defensively. They may live on NativeModules or on a
// global injected by the plugin; either way, missing == undefined.
function getNative(name) {
  try {
    if (NativeModules && NativeModules[name]) return NativeModules[name]
    if (typeof global !== 'undefined' && global[name]) return global[name]
  } catch (_e) {
    /* ignore */
  }
  return null
}

function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Read today's app usage from the native UsageStats module and report it to the
 * server. No-ops gracefully if the native module is missing.
 * @returns {Promise<boolean>} true if usage was reported, false if skipped.
 */
export async function reportUsageToServer(date = todayStr()) {
  const Usage = getNative('GravityUsage')
  if (!Usage || typeof Usage.getUsage !== 'function') {
    console.warn('[parentalControl] GravityUsage native module unavailable — skipping usage report')
    return false
  }
  try {
    const raw = await Usage.getUsage(date)
    const apps = (Array.isArray(raw) ? raw : []).map((a) => ({
      package_name: String(a?.package_name ?? a?.packageName ?? ''),
      app_label: String(a?.app_label ?? a?.appLabel ?? a?.package_name ?? ''),
      foreground_seconds: Number(a?.foreground_seconds ?? a?.foregroundSeconds ?? 0) || 0,
      opens: Number(a?.opens ?? 0) || 0,
    })).filter((a) => a.package_name)

    if (!apps.length) {
      console.warn('[parentalControl] native returned no usage rows — nothing to report')
      return false
    }
    await parentalAPI.reportAppUsage(date, apps)
    return true
  } catch (e) {
    console.warn('[parentalControl] reportUsageToServer failed:', e?.message || e)
    return false
  }
}

/**
 * Pull this device's blocked-app list from the server and hand it to the native
 * blocker module to enforce. Also reports the device's installed apps if the
 * native module can enumerate them. No-ops gracefully if native is missing.
 * @returns {Promise<boolean>} true if the blocked list was applied.
 */
export async function syncBlockedApps() {
  const Blocker = getNative('GravityBlocker')

  let blocked = []
  try {
    const res = await parentalAPI.getMyBlockedApps()
    blocked = Array.isArray(res?.apps) ? res.apps : []
  } catch (e) {
    console.warn('[parentalControl] could not fetch blocked apps:', e?.message || e)
    return false
  }

  if (!Blocker || typeof Blocker.applyBlockedApps !== 'function') {
    console.warn('[parentalControl] GravityBlocker native module unavailable — cannot enforce blocks')
    return false
  }

  try {
    const packages = blocked
      .filter((a) => a && (a.blocked === true || a.blocked === 1))
      .map((a) => String(a.package_name ?? a.packageName ?? ''))
      .filter(Boolean)
    await Blocker.applyBlockedApps(packages)
    return true
  } catch (e) {
    console.warn('[parentalControl] syncBlockedApps failed:', e?.message || e)
    return false
  }
}

export default { reportUsageToServer, syncBlockedApps }
