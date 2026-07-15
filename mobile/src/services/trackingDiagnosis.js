// trackingDiagnosis.js — the pure "why isn't this phone reporting?" decision.
//
// Deliberately imports NOTHING. Kept apart from trackingHealth.js (which reads
// expo-location and react-native) so this logic can be run and tested in a plain
// node process: mobile/ has no test runner or installed deps of its own, and a
// module that pulls in native packages cannot be loaded outside Metro. The
// precedence below is the part worth pinning, so it lives where it can be.

export const ISSUE = {
  SERVICES_OFF: 'services_off',
  FOREGROUND_DENIED: 'foreground_denied',
  BACKGROUND_DENIED: 'background_denied',
  NOT_RUNNING: 'not_running',
}

// `fixable` = the app can plausibly resolve it in-process (ask for the
// permission, restart the task). When false the user has to leave for system
// settings, because Android does not let an app grant these to itself — see
// services/reliability.js.
const DETAIL = {
  [ISSUE.SERVICES_OFF]: {
    title: 'Location is turned off',
    message: 'Turn on Location in your phone settings so your family can see you.',
    fixable: false,
  },
  [ISSUE.FOREGROUND_DENIED]: {
    title: 'Location permission needed',
    message: 'Gravity needs location permission to share where you are.',
    fixable: true,
  },
  [ISSUE.BACKGROUND_DENIED]: {
    title: 'Set location to "Allow all the time"',
    message: 'Right now Gravity only sees you while the app is open. Your family will see you go offline when you close it.',
    fixable: true,
  },
  [ISSUE.NOT_RUNNING]: {
    title: 'Tracking is not running',
    message: 'Your family cannot see you. Tap to restart it.',
    fixable: true,
  },
}

/**
 * Most-fundamental blocker first, because these conditions are NOT independent:
 * Android reports background permission as denied whenever the foreground one
 * is, and reports both as fine when location services are off at the OS level.
 * A phone with location simply switched off therefore looks like three problems
 * at once. Naming the wrong one sends the user to a screen where following the
 * instruction changes nothing — after which they stop believing the banner.
 *
 * taskRunning is checked last and trusted least: it answers "is the task
 * registered", which an OEM that kills the foreground service can leave true.
 *
 * @param {{servicesEnabled:boolean, foregroundGranted:boolean, backgroundGranted:boolean, taskRunning:boolean}} s
 * @returns {{ok:boolean, issue:string|null, title?:string, message?:string, fixable?:boolean}}
 */
export const diagnose = (s) => {
  if (!s.servicesEnabled) return fail(ISSUE.SERVICES_OFF)
  if (!s.foregroundGranted) return fail(ISSUE.FOREGROUND_DENIED)
  if (!s.backgroundGranted) return fail(ISSUE.BACKGROUND_DENIED)
  if (!s.taskRunning) return fail(ISSUE.NOT_RUNNING)
  return { ok: true, issue: null }
}

const fail = (issue) => ({ ok: false, issue, ...DETAIL[issue] })
