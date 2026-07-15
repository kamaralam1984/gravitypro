// Run: npm test
//
// Covers snapDistanceMeters against a stub OSRM. The value of a snap is that it
// replaces chord-summing with the road's real length; the risk is that it
// replaces a merely-imprecise number with a confidently wrong one. So what is
// asserted here is mostly when snapping is REFUSED — an unreachable OSRM, a
// region outside the extract, or a match so far off the GPS trail that OSRM
// clearly reconciled it by inventing a detour.

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const Module = require('node:module')

let lastPath = null
let respond = null

const server = http.createServer((req, res) => {
  lastPath = req.url
  respond(res)
})

// routing.js reads OSRM_BASE_URL at require time, so the stub has to be
// listening and the env var set before it is first loaded — hence the deferred
// require here rather than at the top of the file.
let snapDistanceMeters, SNAP_MIN_RATIO, SNAP_MAX_RATIO
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.OSRM_BASE_URL = `http://127.0.0.1:${server.address().port}`

  // routing.js pulls in ../config/db (for route_cache) which needs `pg`, a real
  // dependency this suite has no use for — snapDistanceMeters never touches the
  // cache. Stub it so the tests stay dependency-free and can never reach a DB.
  const origLoad = Module._load
  Module._load = function (request, parent, ...rest) {
    if (request === '../config/db' && parent?.filename?.endsWith('routing.js')) {
      return { query: async () => ({ rows: [] }) }
    }
    return origLoad.call(this, request, parent, ...rest)
  }
  ;({ snapDistanceMeters, SNAP_MIN_RATIO, SNAP_MAX_RATIO } = require('./routing'))
  Module._load = origLoad
})

test.after(() => server.close())

const ok = (distanceMeters) => (res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({
    code: 'Ok',
    routes: [{ distance: distanceMeters, duration: 60, geometry: { coordinates: [[77.2, 28.6], [77.21, 28.61]] } }],
  }))
}

// ~1km apart, so the chord sum is a round number to reason about.
const TRACK = [
  { lat: 28.6139, lng: 77.209 },
  { lat: 28.6229, lng: 77.209 },  // ~1000m north
  { lat: 28.6319, lng: 77.209 },  // ~1000m more
]
const CHORD = 2000 // metres, near enough

test('reports the road length when OSRM matches the trail plausibly', async () => {
  // A real road between these points is a bit longer than the chord — the whole
  // point of snapping.
  respond = ok(2300)
  const d = await snapDistanceMeters(TRACK)
  assert.ok(d != null, 'a plausible snap should be used')
  assert.strictEqual(Math.round(d), 2300)
  assert.match(lastPath, /^\/route\/v1\/driving\//)
})

test('sends lng,lat to OSRM — the opposite order to the rest of the codebase', async () => {
  respond = ok(2300)
  await snapDistanceMeters(TRACK)
  // Getting this backwards silently routes somewhere in the ocean rather than
  // erroring, so assert the actual order on the wire.
  assert.ok(lastPath.includes('77.209,28.6139'), `expected lng,lat first; got ${lastPath}`)
  assert.ok(!lastPath.includes('28.6139,77.209'), 'lat,lng order leaked into the OSRM call')
})

test('refuses a snap that undercuts the straight line', async () => {
  // No road is shorter than the crow flies. Under the chord means OSRM matched
  // the wrong roads entirely.
  respond = ok(CHORD * (SNAP_MIN_RATIO - 0.2))
  assert.strictEqual(await snapDistanceMeters(TRACK), null)
})

test('refuses a snap that invents a long detour', async () => {
  // Far over the chord means OSRM could not match the fixes and bridged them the
  // long way round — distance the child never travelled.
  respond = ok(CHORD * (SNAP_MAX_RATIO + 1))
  assert.strictEqual(await snapDistanceMeters(TRACK), null)
})

test('accepts a snap right inside the plausible band', async () => {
  respond = ok(CHORD * (SNAP_MAX_RATIO - 0.1))
  assert.notStrictEqual(await snapDistanceMeters(TRACK), null)
  respond = ok(CHORD * (SNAP_MIN_RATIO + 0.05))
  assert.notStrictEqual(await snapDistanceMeters(TRACK), null)
})

test('returns null, not a throw, when the region is outside the extract', async () => {
  // What OSRM actually answers for coordinates it has no road graph for. The
  // extract covers one zone, not all of India, so this is the normal case for
  // most of the country — it must degrade to the chord sum, never 500.
  respond = (res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 'NoSegment', message: 'Could not find a matching segment' }))
  }
  assert.strictEqual(await snapDistanceMeters(TRACK), null)
})

test('returns null, not a throw, when OSRM errors', async () => {
  respond = (res) => { res.statusCode = 500; res.end('boom') }
  assert.strictEqual(await snapDistanceMeters(TRACK), null)
})

test('returns null when OSRM sends a nonsense distance', async () => {
  for (const bogus of [0, -5, null, 'abc']) {
    respond = ok(bogus)
    assert.strictEqual(await snapDistanceMeters(TRACK), null, `distance ${bogus} should be rejected`)
  }
})

test('does not call OSRM for a track too short to snap', async () => {
  lastPath = null
  respond = ok(999)
  assert.strictEqual(await snapDistanceMeters([{ lat: 28.6, lng: 77.2 }]), null)
  assert.strictEqual(await snapDistanceMeters([]), null)
  assert.strictEqual(await snapDistanceMeters(null), null)
  assert.strictEqual(lastPath, null, 'a degenerate track must not reach OSRM')
})

test('does not call OSRM when every fix is the same spot', async () => {
  // Chord 0 would make the plausibility ratio a divide-by-zero.
  lastPath = null
  respond = ok(500)
  const still = [{ lat: 28.6, lng: 77.2 }, { lat: 28.6, lng: 77.2 }, { lat: 28.6, lng: 77.2 }]
  assert.strictEqual(await snapDistanceMeters(still), null)
  assert.strictEqual(lastPath, null)
})
