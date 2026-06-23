# Parental Control — Native Android Scaffolding

This directory contains an **Expo config plugin + reference Kotlin** that scaffolds two
native Android parental-control capabilities for GravityPro
(`com.trackalways.gravity`, Expo SDK 54):

- **A) App usage / screen time** via Android `UsageStatsManager`.
- **B) App blocking** via an `AccessibilityService` that watches the foreground app
  and sends the user to the home screen (with a "Blocked by parent" toast) when a
  blocked app opens.

> ⚠️ **This is SCAFFOLDING. It is INERT until you run a native rebuild AND the user
> grants the special permissions on a real device.** It does nothing in Expo Go, on
> the web, on iOS, or in any build produced before `expo prebuild` runs the plugin.
> A real Android device is required (UsageStats/Accessibility are unavailable or
> stubbed on most emulators).

---

## Files

| File | Purpose |
|------|---------|
| `withParentalControl.js` | Expo config plugin. On prebuild: adds manifest permissions + the AccessibilityService `<service>` entry, copies the Kotlin/xml into `android/`, and registers the ReactPackage in `MainApplication.kt`. Idempotent. |
| `static/kotlin/GravityUsageModule.kt` | Native module `GravityUsage` — UsageStats reads. |
| `static/kotlin/GravityBlockerModule.kt` | Native module `GravityBlocker` — blocked-list + accessibility state. |
| `static/kotlin/BlockerAccessibilityService.kt` | The AccessibilityService that enforces blocking. |
| `static/kotlin/GravityParentalPackage.kt` | `ReactPackage` registering both modules. |
| `static/xml/accessibility_service_config.xml` | Accessibility service config (`@xml/accessibility_service_config`). |

The plugin copies the `static/kotlin/*.kt` files into
`android/app/src/main/java/com/trackalways/gravity/` and the xml into
`android/app/src/main/res/xml/` on every prebuild.

---

## Permissions added to AndroidManifest

| Permission | Type | How it is granted |
|------------|------|-------------------|
| `android.permission.PACKAGE_USAGE_STATS` | Special (signature/appop) | User toggles **Settings → Apps → Special app access → Usage access → GravityPro**. Cannot be granted by a runtime dialog. Declared with `tools:ignore="ProtectedPermissions"` so the manifest merger does not error. |
| `android.permission.QUERY_ALL_PACKAGES` | Normal-ish (Play-restricted, see caveats) | Auto-granted; used to resolve human-readable app labels. |
| `android.permission.BIND_ACCESSIBILITY_SERVICE` | Service-binding permission | Declared on the `<service>`; the user enables the service under **Settings → Accessibility → Installed services → GravityPro App Blocker**. |

---

## JS bridge — exact names & signatures

Accessed via `import { NativeModules } from 'react-native'` →
`NativeModules.GravityUsage` and `NativeModules.GravityBlocker`. The wrapper module
`src/services/parentalControl.js` calls these.

### `NativeModules.GravityUsage`
| Method | Signature | Returns |
|--------|-----------|---------|
| `hasUsagePermission()` | `() → Promise<boolean>` | whether Usage Access is granted |
| `openUsageAccessSettings()` | `() → Promise<boolean>` | opens the Usage Access settings screen |
| `getUsageStats(startMs, endMs)` | `(number, number) → Promise<Array>` | rows `{ packageName, label, totalForegroundSeconds, opens }` (camelCase) |
| `getUsage(date)` | `("YYYY-MM-DD") → Promise<Array>` | **compat alias** for the existing JS service; rows `{ package_name, app_label, foreground_seconds, opens }` (snake_case) |

### `NativeModules.GravityBlocker`
| Method | Signature | Returns |
|--------|-----------|---------|
| `isAccessibilityEnabled()` | `() → Promise<boolean>` | whether the AccessibilityService is enabled |
| `openAccessibilitySettings()` | `() → Promise<boolean>` | opens the Accessibility settings screen |
| `setBlockedPackages(list)` | `(string[]) → Promise<boolean>` | persists the blocked package set to SharedPreferences |
| `applyBlockedApps(list)` | `(string[]) → Promise<boolean>` | **compat alias** for `setBlockedPackages`, matching the existing JS service |

> **Why two shapes?** The repo already shipped `src/services/parentalControl.js`,
> which calls `GravityUsage.getUsage(date)` and `GravityBlocker.applyBlockedApps(...)`.
> The Kotlin modules expose **both** the spec method names (`getUsageStats`,
> `setBlockedPackages`) and those compat aliases so the existing JS keeps working
> unchanged. Use whichever pair you prefer; prefer the spec names for new code.

---

## How to activate (native rebuild required)

1. Ensure the plugin is wired in `app.config.js` (it is — `./plugins/withParentalControl`
   is pushed into `config.plugins`).
2. From `mobile/`:
   ```bash
   npx expo prebuild --platform android   # runs the config plugin → patches android/
   npx expo run:android                   # or: eas build -p android
   ```
   (Or `npm run android`.)
3. Install the resulting build on a **real Android device**.

### On the device, the user must manually:
- **Usage / screen time:** Settings → Apps → Special app access → **Usage access** →
  GravityPro → enable. (Your app can deep-link there via `openUsageAccessSettings()`.)
- **App blocking:** Settings → **Accessibility** → Installed services →
  **GravityPro App Blocker** → enable. (Deep-link via `openAccessibilitySettings()`.)

Until both are granted, `hasUsagePermission()` / `isAccessibilityEnabled()` return
`false` and the features no-op.

---

## `MainApplication.kt` registration

The plugin's `withMainApplication` step inserts `add(GravityParentalPackage())` into
the `PackageList(this).packages.apply { ... }` block automatically on prebuild. If you
maintain `MainApplication.kt` by hand instead, add that line yourself.

---

## Play Store policy caveats (read before shipping)

- **`PACKAGE_USAGE_STATS` / Usage Access** — allowed for genuine parental-control /
  digital-wellbeing apps, but Google requires prominent disclosure and a privacy
  policy. Misuse → rejection.
- **AccessibilityService for blocking** — Google heavily restricts AccessibilityService
  use. Apps must declare an `IsAccessibilityTool` / accessibility-use disclosure and
  justify it; parental control is an accepted use case but expect manual review. Do
  **not** use the service for anything beyond the stated blocking purpose.
- **`QUERY_ALL_PACKAGES`** — a "sensitive" permission. Google requires a declaration
  form justifying why full package visibility is needed (here: to list/label apps for
  the parent). Consider a `<queries>` allow-list instead if you can scope it down.
- Provide a clear privacy policy and in-app disclosure of monitoring/blocking before
  enabling these features.

---

## Status

**Not active until rebuilt.** This commit only adds source + manifest scaffolding. No
gradle build is run here. Verified that `app.config.js` and `withParentalControl.js`
both load without error (`node -e require(...)`).
