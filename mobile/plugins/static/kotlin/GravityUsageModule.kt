package com.trackalways.gravity

import android.app.AppOpsManager
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * GravityUsage — React Native bridge module exposing Android UsageStatsManager
 * (app usage / screen-time) data to JS.
 *
 * JS access: NativeModules.GravityUsage
 *
 * Requires the special PACKAGE_USAGE_STATS permission, which the user must grant
 * manually under Settings -> Apps -> Special app access -> Usage access. It cannot
 * be granted by a runtime permission dialog.
 */
class GravityUsageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "GravityUsage"

  /** True if the user has granted Usage Access to this app. */
  @ReactMethod
  fun hasUsagePermission(promise: Promise) {
    try {
      val context = reactApplicationContext
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName
        )
      } else {
        @Suppress("DEPRECATION")
        appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName
        )
      }
      promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    } catch (e: Exception) {
      promise.reject("USAGE_PERM_CHECK_FAILED", e)
    }
  }

  /** Opens the system Usage Access settings screen so the user can grant access. */
  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("OPEN_USAGE_SETTINGS_FAILED", e)
    }
  }

  /**
   * Returns aggregated per-package usage between startMs and endMs (epoch millis).
   * Each entry: { packageName, label, totalForegroundSeconds, opens }.
   */
  @ReactMethod
  fun getUsageStats(startMs: Double, endMs: Double, promise: Promise) {
    try {
      val context = reactApplicationContext
      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val pm = context.packageManager

      val start = startMs.toLong()
      val end = endMs.toLong()

      // queryAndAggregateUsageStats merges multiple buckets into one entry per package.
      val aggregated: Map<String, UsageStats> =
          usm.queryAndAggregateUsageStats(start, end)

      val result: WritableArray = Arguments.createArray()

      for ((packageName, stats) in aggregated) {
        val totalForegroundMs = stats.totalTimeInForeground
        if (totalForegroundMs <= 0L) continue

        val opens = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          // Number of times the app launched / came to foreground.
          stats.totalTimeForegroundServiceUsed.let { _ -> }
          getLaunchCount(stats)
        } else {
          getLaunchCount(stats)
        }

        val label = resolveLabel(pm, packageName)

        val map: WritableMap = Arguments.createMap()
        map.putString("packageName", packageName)
        map.putString("label", label)
        map.putDouble("totalForegroundSeconds", (totalForegroundMs / 1000L).toDouble())
        map.putInt("opens", opens)
        result.pushMap(map)
      }

      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("GET_USAGE_STATS_FAILED", e)
    }
  }

  /**
   * Compatibility alias matching the existing JS service
   * (src/services/parentalControl.js -> reportUsageToServer).
   *
   * Accepts a "YYYY-MM-DD" date string, computes that day's [start,end) window,
   * and returns rows shaped { package_name, app_label, foreground_seconds, opens }
   * which is the snake_case shape the JS layer normalises.
   */
  @ReactMethod
  fun getUsage(date: String, promise: Promise) {
    try {
      val parts = date.split("-")
      val cal = java.util.Calendar.getInstance()
      if (parts.size == 3) {
        cal.set(java.util.Calendar.YEAR, parts[0].toInt())
        cal.set(java.util.Calendar.MONTH, parts[1].toInt() - 1)
        cal.set(java.util.Calendar.DAY_OF_MONTH, parts[2].toInt())
      }
      cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
      cal.set(java.util.Calendar.MINUTE, 0)
      cal.set(java.util.Calendar.SECOND, 0)
      cal.set(java.util.Calendar.MILLISECOND, 0)
      val start = cal.timeInMillis
      val end = start + 24L * 60L * 60L * 1000L

      val context = reactApplicationContext
      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val pm = context.packageManager
      val aggregated = usm.queryAndAggregateUsageStats(start, end)

      val result: WritableArray = Arguments.createArray()
      for ((packageName, stats) in aggregated) {
        val fgMs = stats.totalTimeInForeground
        if (fgMs <= 0L) continue
        val map: WritableMap = Arguments.createMap()
        map.putString("package_name", packageName)
        map.putString("app_label", resolveLabel(pm, packageName))
        map.putDouble("foreground_seconds", (fgMs / 1000L).toDouble())
        map.putInt("opens", getLaunchCount(stats))
        result.pushMap(map)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("GET_USAGE_FAILED", e)
    }
  }

  private fun getLaunchCount(stats: UsageStats): Int {
    // UsageStats exposes app-launch count via reflection-safe accessor on some APIs.
    return try {
      val method = UsageStats::class.java.getMethod("getAppLaunchCount")
      (method.invoke(stats) as? Int) ?: 0
    } catch (e: Exception) {
      0
    }
  }

  private fun resolveLabel(pm: PackageManager, packageName: String): String {
    return try {
      val info: ApplicationInfo = pm.getApplicationInfo(packageName, 0)
      pm.getApplicationLabel(info).toString()
    } catch (e: Exception) {
      packageName
    }
  }
}
