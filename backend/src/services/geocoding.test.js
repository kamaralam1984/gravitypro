// Run: npm test
//
// Covers warmPlaceName's guards rather than its output. The guards are the whole
// point of it: it hangs off GET /circles/:id/members, which every parent's app
// polls continuously, and it spends a metered quota that timelineStops needs for
// Timeline stop names. A regression here does not show up as a wrong label — it
// shows up as an exhausted LocationIQ quota and stop names that stop resolving.
//
// No network and no database is touched: `../config/db` is swapped for a stub
// that always reports a cache miss (the interesting path), and global.fetch
// counts calls instead of making them.

const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')

// Swap ../config/db before geocoding.js is first required, so its module-level
// `const { query } = require('../config/db')` binds to the stub. node:test's
// mock.module needs --experimental-test-module-mocks, hence the manual hook.
const origLoad = Module._load
Module._load = function (request, parent, ...rest) {
  if (request === '../config/db' && parent?.filename?.endsWith('geocoding.js')) {
    return { query: async () => ({ rows: [] }) } // always a cache miss
  }
  return origLoad.call(this, request, parent, ...rest)
}
const { warmPlaceName, WARM_MIN_INTERVAL_MS } = require('./geocoding')
Module._load = origLoad

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let apiCalls = 0
const stubFetch = () => {
  apiCalls = 0
  global.fetch = async () => {
    apiCalls++
    return {
      ok: true,
      json: async () => ({ address: { suburb: 'Andheri East' }, display_name: 'Andheri East, Mumbai' }),
    }
  }
}

// warmPlaceName's rate limiter is module-level state shared by every test here,
// so each test that wants to actually reach the API must first wait out the
// slot the previous one consumed.
const freshSlot = () => sleep(WARM_MIN_INTERVAL_MS + 50)

// Distinct cells, so the per-cell dedupe never masks a rate-limit failure.
const cell = (i) => [19 + i * 0.01, 72.8 + i * 0.01]

test('a burst of parents polling one child costs a single API call', async () => {
  process.env.LOCATIONIQ_API_KEY = 'test-key'
  stubFetch()
  await freshSlot()

  for (let i = 0; i < 50; i++) warmPlaceName(28.6139, 77.209)
  await sleep(100)

  assert.strictEqual(apiCalls, 1, 'the in-flight cell guard should collapse these into one call')
})

test('warms are dropped, not queued, when out of rate limit', async () => {
  process.env.LOCATIONIQ_API_KEY = 'test-key'
  stubFetch()
  await freshSlot()

  for (let i = 0; i < 30; i++) warmPlaceName(...cell(i))
  await sleep(100)
  assert.strictEqual(apiCalls, 1, 'only the first should get through')

  // The dropped 29 must be gone for good. If they were queued, they would drain
  // here and burn quota long after the request that asked for them.
  await sleep(WARM_MIN_INTERVAL_MS * 3)
  assert.strictEqual(apiCalls, 1, 'dropped warms must never drain later')
})

test('does nothing without an API key', async () => {
  const saved = process.env.LOCATIONIQ_API_KEY
  delete process.env.LOCATIONIQ_API_KEY
  stubFetch()
  await freshSlot()

  for (let i = 0; i < 5; i++) warmPlaceName(...cell(i + 100))
  await sleep(100)

  assert.strictEqual(apiCalls, 0)
  if (saved) process.env.LOCATIONIQ_API_KEY = saved
})

test('is fire-and-forget: callers cannot await it', async () => {
  process.env.LOCATIONIQ_API_KEY = 'test-key'
  stubFetch()
  await freshSlot()

  // Callers sit on a response path, so this must not be awaitable by accident.
  assert.strictEqual(warmPlaceName(28.6139, 77.209), undefined)
  await sleep(50)
})

test('garbage coordinates never reach the API', async () => {
  process.env.LOCATIONIQ_API_KEY = 'test-key'
  stubFetch()
  // A fresh slot on purpose: with the rate limiter already spent, these would be
  // dropped for the wrong reason and the test would pass even with the input
  // check removed.
  await freshSlot()

  for (const [lat, lng] of [[null, null], ['x', 'y'], [NaN, 5], [undefined, undefined], [{}, []]]) {
    assert.strictEqual(warmPlaceName(lat, lng), undefined, `warmPlaceName(${lat}, ${lng}) should be a no-op`)
  }
  await sleep(100)
  assert.strictEqual(apiCalls, 0, 'garbage coordinates must not reach the API')
})

test('a rejecting API does not produce an unhandled rejection', async () => {
  process.env.LOCATIONIQ_API_KEY = 'test-key'
  await freshSlot()
  global.fetch = async () => { throw new Error('network down') }

  let unhandled = null
  const onUnhandled = (err) => { unhandled = err }
  process.on('unhandledRejection', onUnhandled)

  warmPlaceName(...cell(200))
  await sleep(100)

  process.off('unhandledRejection', onUnhandled)
  assert.strictEqual(unhandled, null, 'warmPlaceName must swallow its own failures')
})
