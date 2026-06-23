package com.trackalways.gravity

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * GravityParentalPackage — registers the two parental-control native modules
 * (GravityUsage and GravityBlocker) with React Native.
 *
 * This package must be added to MainApplication's getPackages() list. The
 * withParentalControl config plugin does this automatically on prebuild, but
 * if you maintain MainApplication.kt by hand add:
 *
 *     add(GravityParentalPackage())
 *
 * inside the PackageList(this).packages.apply { ... } block.
 */
class GravityParentalPackage : ReactPackage {
  override fun createNativeModules(
      reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(
      GravityUsageModule(reactContext),
      GravityBlockerModule(reactContext)
  )

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
