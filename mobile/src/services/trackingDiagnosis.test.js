// Run: npm test   (from mobile/)
//
// Targets trackingDiagnosis.js — the pure decision — not trackingHealth.js,
// which reads expo-location and cannot load outside Metro. So what is covered is
// the precedence, and what is NOT covered is whether the real OS reports the
// states we believe it does. That gap is real: these tests would still pass if
// expo-location's actual semantics differed from the assumption below.
//
// The precedence is the part worth pinning because the inputs are not
// independent. Android reports background permission as denied whenever the
// foreground one is, and reports both as fine when location services are off. A
// phone with location simply switched off therefore arrives here looking like
// three problems at once, and naming the wrong one sends someone to a settings
// screen where following the instruction changes nothing.

import test from 'node:test'
import assert from 'node:assert'
import { diagnose, ISSUE } from './trackingDiagnosis.js'

// A phone that is fully working, which each test then breaks in exactly one way.
const healthy = () => ({
  servicesEnabled: true,
  foregroundGranted: true,
  backgroundGranted: true,
  taskRunning: true,
})

test('a working phone reports no issue', () => {
  assert.deepStrictEqual(diagnose(healthy()), { ok: true, issue: null })
})

test('location switched off outranks the permissions it also breaks', () => {
  // The realistic shape: services off AND both permissions reading denied AND
  // nothing running. Only the first is worth telling anyone about.
  const h = diagnose({
    servicesEnabled: false,
    foregroundGranted: false,
    backgroundGranted: false,
    taskRunning: false,
  })
  assert.strictEqual(h.issue, ISSUE.SERVICES_OFF)
  assert.strictEqual(h.fixable, false, 'the app cannot switch location services on for the user')
})

test('foreground permission outranks the background permission it also blocks', () => {
  // Android will not grant background without foreground, so it reports both
  // denied. Asking for background first shows a dialog that cannot succeed.
  const h = diagnose({ ...healthy(), foregroundGranted: false, backgroundGranted: false, taskRunning: false })
  assert.strictEqual(h.issue, ISSUE.FOREGROUND_DENIED)
})

test('"while using the app" is called out as its own problem', () => {
  // The quietest failure of the lot: everything looks granted, the app works
  // while open, and the family only sees them vanish once it closes.
  const h = diagnose({ ...healthy(), backgroundGranted: false })
  assert.strictEqual(h.issue, ISSUE.BACKGROUND_DENIED)
  assert.match(h.title, /all the time/i)
})

test('permissions granted but the task dead is still reported', () => {
  // What an OEM battery-killer leaves behind: nothing to fix in settings, the
  // task just is not running.
  assert.strictEqual(diagnose({ ...healthy(), taskRunning: false }).issue, ISSUE.NOT_RUNNING)
})

test('every issue carries text a person can act on', () => {
  const breakages = [
    { ...healthy(), servicesEnabled: false },
    { ...healthy(), foregroundGranted: false },
    { ...healthy(), backgroundGranted: false },
    { ...healthy(), taskRunning: false },
  ]
  for (const s of breakages) {
    const h = diagnose(s)
    assert.ok(h.title && h.message, `issue ${h.issue} has no user-facing text`)
    assert.strictEqual(typeof h.fixable, 'boolean', `issue ${h.issue} does not say whether the app can fix it`)
    assert.strictEqual(h.ok, false)
  }
})

test('only location-services-off sends the user out to settings', () => {
  // If everything were marked unfixable the banner would be a dead end; if
  // everything were marked fixable the app would promise a result it cannot
  // deliver for a toggle only the OS owns.
  assert.strictEqual(diagnose({ ...healthy(), servicesEnabled: false }).fixable, false)
  for (const s of [
    { ...healthy(), foregroundGranted: false },
    { ...healthy(), backgroundGranted: false },
    { ...healthy(), taskRunning: false },
  ]) {
    assert.strictEqual(diagnose(s).fixable, true)
  }
})
