/**
 * withParentalControl — Expo config plugin that scaffolds the two native
 * Android parental-control capabilities for GravityPro:
 *
 *   A) App usage / screen time  (UsageStatsManager, PACKAGE_USAGE_STATS)
 *   B) App blocking             (AccessibilityService)
 *
 * On `expo prebuild` it:
 *   1. Adds uses-permission entries to AndroidManifest:
 *        - android.permission.PACKAGE_USAGE_STATS (with tools:ignore so the
 *          manifest merger doesn't flag the special permission)
 *        - android.permission.QUERY_ALL_PACKAGES (to resolve app labels)
 *   2. Registers the AccessibilityService <service> entry (guarded by
 *      android.permission.BIND_ACCESSIBILITY_SERVICE) plus its
 *      accessibility config meta-data.
 *   3. Copies the reference Kotlin sources + res/xml + strings into the
 *      android/ project, and wires GravityParentalPackage() into
 *      MainApplication.kt.
 *
 * Every step is idempotent — running prebuild repeatedly does not duplicate
 * entries.
 *
 * IMPORTANT: This is scaffolding. The capabilities are inert until you run a
 * native rebuild (`npx expo prebuild` then `expo run:android` / EAS build) AND
 * the user grants the special permissions on the device. See
 * plugins/PARENTAL_CONTROL_README.md.
 */
const fs = require('fs')
const path = require('path')
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('@expo/config-plugins')

const PACKAGE = 'com.trackalways.gravity'
const SERVICE_CLASS = '.BlockerAccessibilityService'
const TOOLS_NS = 'http://schemas.android.com/tools'

const KOTLIN_FILES = [
  'GravityUsageModule.kt',
  'GravityBlockerModule.kt',
  'BlockerAccessibilityService.kt',
  'GravityParentalPackage.kt',
]

// --- Manifest: permissions ---------------------------------------------------

function addUsesPermissions(androidManifest) {
  const manifest = androidManifest.manifest

  // Ensure the tools namespace is declared so tools:ignore is honored.
  manifest.$ = manifest.$ || {}
  if (!manifest.$['xmlns:tools']) {
    manifest.$['xmlns:tools'] = TOOLS_NS
  }

  manifest['uses-permission'] = manifest['uses-permission'] || []
  const perms = manifest['uses-permission']

  const has = (name) =>
    perms.some((p) => p.$ && p.$['android:name'] === name)

  if (!has('android.permission.PACKAGE_USAGE_STATS')) {
    perms.push({
      $: {
        'android:name': 'android.permission.PACKAGE_USAGE_STATS',
        'tools:ignore': 'ProtectedPermissions',
      },
    })
  }

  if (!has('android.permission.QUERY_ALL_PACKAGES')) {
    perms.push({
      $: { 'android:name': 'android.permission.QUERY_ALL_PACKAGES' },
    })
  }

  return androidManifest
}

// --- Manifest: AccessibilityService <service> --------------------------------

function addAccessibilityService(androidManifest) {
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest)

  application.service = application.service || []
  const services = application.service

  const serviceName = PACKAGE + SERVICE_CLASS
  const already = services.some(
    (s) => s.$ && s.$['android:name'] === serviceName
  )
  if (already) return androidManifest

  services.push({
    $: {
      'android:name': serviceName,
      'android:exported': 'false',
      'android:label': 'GravityPro App Blocker',
      'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
    },
    'intent-filter': [
      {
        action: [
          {
            $: {
              'android:name': 'android.accessibilityservice.AccessibilityService',
            },
          },
        ],
      },
    ],
    'meta-data': [
      {
        $: {
          'android:name': 'android.accessibilityservice',
          'android:resource': '@xml/accessibility_service_config',
        },
      },
    ],
  })

  return androidManifest
}

// --- Dangerous mod: copy Kotlin + xml + strings ------------------------------

function ensureFile(destPath, contents) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  // Always (re)write so source-of-truth stays the plugin's static files;
  // this is still idempotent (same bytes -> same result).
  fs.writeFileSync(destPath, contents)
}

function copyKotlinAndResources(projectRoot) {
  const staticDir = path.join(__dirname, 'static')
  const javaDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'trackalways',
    'gravity'
  )
  const xmlDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'xml'
  )

  for (const file of KOTLIN_FILES) {
    const src = path.join(staticDir, 'kotlin', file)
    const contents = fs.readFileSync(src, 'utf8')
    ensureFile(path.join(javaDir, file), contents)
  }

  const xmlSrc = path.join(
    staticDir,
    'xml',
    'accessibility_service_config.xml'
  )
  ensureFile(
    path.join(xmlDir, 'accessibility_service_config.xml'),
    fs.readFileSync(xmlSrc, 'utf8')
  )
}

// --- Dangerous mod: ensure the description string exists ----------------------

function ensureStringResource(projectRoot) {
  const stringsPath = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'values',
    'strings.xml'
  )
  if (!fs.existsSync(stringsPath)) return // prebuild generates it; bail safely

  let contents = fs.readFileSync(stringsPath, 'utf8')
  if (contents.includes('accessibility_service_description')) return

  const entry =
    '    <string name="accessibility_service_description">' +
    'GravityPro monitors the foreground app so a parent can block selected ' +
    'apps. When a blocked app opens you are returned to the home screen.' +
    '</string>'

  contents = contents.replace(
    /<\/resources>/,
    entry + '\n</resources>'
  )
  fs.writeFileSync(stringsPath, contents)
}

// --- MainApplication: register the ReactPackage ------------------------------

function withParentalMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents
    if (src.includes('GravityParentalPackage()')) return cfg

    // Insert into the PackageList(...).packages.apply { ... } block.
    const marker = 'PackageList(this).packages.apply {'
    if (src.includes(marker)) {
      src = src.replace(
        marker,
        marker + '\n              add(GravityParentalPackage())'
      )
    }
    cfg.modResults.contents = src
    return cfg
  })
}

// --- Compose -----------------------------------------------------------------

module.exports = function withParentalControl(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = addUsesPermissions(cfg.modResults)
    cfg.modResults = addAccessibilityService(cfg.modResults)
    return cfg
  })

  config = withParentalMainApplication(config)

  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      copyKotlinAndResources(projectRoot)
      ensureStringResource(projectRoot)
      return cfg
    },
  ])

  return config
}
