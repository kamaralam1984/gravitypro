package com.trackalways.gravity

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast

/**
 * BlockerAccessibilityService — watches the foreground app and, if that app is
 * in the parent-configured blocked set, immediately sends the user to the home
 * screen and shows a "Blocked by parent" toast.
 *
 * The blocked set is read from SharedPreferences (written by GravityBlockerModule)
 * so it stays in sync with the JS layer without an active bridge.
 *
 * This service does nothing until the user enables it under
 * Settings -> Accessibility -> Installed services.
 *
 * NOTE: For a full-screen "Blocked by parent" overlay you would additionally
 * request SYSTEM_ALERT_WINDOW and inflate a WindowManager overlay here. The
 * GLOBAL_ACTION_HOME approach below is the most policy-friendly baseline.
 */
class BlockerAccessibilityService : AccessibilityService() {

  private val mainHandler = Handler(Looper.getMainLooper())
  private var lastBlockedPackage: String? = null
  private var lastBlockTime: Long = 0L

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

    val packageName = event.packageName?.toString() ?: return
    if (packageName == applicationContext.packageName) return

    val blocked = readBlockedPackages()
    if (!blocked.contains(packageName)) return

    val now = System.currentTimeMillis()
    // Debounce so we don't spam HOME / toast on repeated window events.
    if (packageName == lastBlockedPackage && now - lastBlockTime < 1500L) return
    lastBlockedPackage = packageName
    lastBlockTime = now

    performGlobalAction(GLOBAL_ACTION_HOME)

    mainHandler.post {
      Toast.makeText(
          applicationContext,
          "Blocked by parent",
          Toast.LENGTH_SHORT
      ).show()
    }
  }

  override fun onInterrupt() {
    // Required override; no-op.
  }

  private fun readBlockedPackages(): Set<String> {
    val prefs = applicationContext.getSharedPreferences(
        GravityBlockerModule.PREFS_NAME,
        Context.MODE_PRIVATE
    )
    return prefs.getStringSet(GravityBlockerModule.KEY_BLOCKED, emptySet()) ?: emptySet()
  }
}
