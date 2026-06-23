package com.trackalways.gravity

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * GravityBlocker — React Native bridge module for app blocking.
 *
 * JS access: NativeModules.GravityBlocker
 *
 * The blocked-package list is persisted to SharedPreferences so the
 * BlockerAccessibilityService (which runs in its own lifecycle) can read it
 * even when the JS bundle is not running.
 *
 * Blocking enforcement requires the AccessibilityService to be enabled by the
 * user under Settings -> Accessibility -> Installed services. It cannot be
 * granted by a runtime permission dialog.
 */
class GravityBlockerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val PREFS_NAME = "gravity_blocker_prefs"
    const val KEY_BLOCKED = "blocked_packages"
  }

  override fun getName(): String = "GravityBlocker"

  /** True if this app's AccessibilityService is currently enabled by the user. */
  @ReactMethod
  fun isAccessibilityEnabled(promise: Promise) {
    try {
      val context = reactApplicationContext
      val expected =
          context.packageName + "/" + BlockerAccessibilityService::class.java.name
      val enabledServices = Settings.Secure.getString(
          context.contentResolver,
          Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: ""

      val splitter = TextUtils.SimpleStringSplitter(':')
      splitter.setString(enabledServices)
      var enabled = false
      while (splitter.hasNext()) {
        if (splitter.next().equals(expected, ignoreCase = true)) {
          enabled = true
          break
        }
      }
      promise.resolve(enabled)
    } catch (e: Exception) {
      promise.reject("ACCESSIBILITY_CHECK_FAILED", e)
    }
  }

  /** Opens the system Accessibility settings screen so the user can enable the service. */
  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("OPEN_ACCESSIBILITY_SETTINGS_FAILED", e)
    }
  }

  /**
   * Persists the list of package names that should be blocked. The
   * AccessibilityService reads this set on each foreground-app change.
   */
  @ReactMethod
  fun setBlockedPackages(packages: ReadableArray, promise: Promise) {
    try {
      val set = HashSet<String>()
      for (i in 0 until packages.size()) {
        val pkg = packages.getString(i)
        if (pkg != null && pkg.isNotEmpty()) set.add(pkg)
      }
      val prefs = reactApplicationContext.getSharedPreferences(
          PREFS_NAME, Context.MODE_PRIVATE
      )
      prefs.edit().putStringSet(KEY_BLOCKED, set).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SET_BLOCKED_PACKAGES_FAILED", e)
    }
  }

  /**
   * Compatibility alias matching the existing JS service
   * (src/services/parentalControl.js -> syncBlockedApps). Identical behaviour
   * to setBlockedPackages.
   */
  @ReactMethod
  fun applyBlockedApps(packages: ReadableArray, promise: Promise) {
    setBlockedPackages(packages, promise)
  }
}
