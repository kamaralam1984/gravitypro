// Run: npm test        (node's built-in runner — no test deps)
//
// These lock the behaviour that motivated the accuracy-scaled jitter gate. The
// filter trades two errors off against each other, so a change that "improves"
// one number usually pays for it in another: shrinking the stationary radius
// counts more slow travel but lets more drift through, and widening it does the
// reverse. The point of the numbers below is to make that trade visible when
// someone retunes the constants, rather than to assert the tuning is optimal.
//
// Tracks are synthetic — real GPS is messier, and no assertion here says the
// filter is correct on a real device.

const test = require('node:test')
const assert = require('node:assert')
const { filterTrack, haversine, stationaryRadiusFor } = require('./gpsFilter')

const T0 = new Date('2026-07-15T09:00:00Z').getTime()
const M_PER_DEG_LAT = 111320

// Deterministic PRNG — a fixed seed keeps drift identical run to run, so a
// failure means the code changed, not that the dice rolled badly.
const rand = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

/**
 * Build a track heading due north.
 * @param {object} o
 * @param {number} o.fixes      how many fixes
 * @param {number} o.stepM      real northward travel between fixes, in metres
 * @param {number|null} o.acc   accuracy each fix reports (null = reports none)
 * @param {number} o.everyMs    wall-clock gap between fixes
 * @param {number} [o.driftM]   GPS noise added to each fix, +/- this many metres
 */
const track = ({ fixes, stepM, acc, everyMs, driftM = 0 }) => {
  const rnd = rand(42)
  const noise = () => (driftM ? (rnd() - 0.5) * 2 * (driftM / M_PER_DEG_LAT) : 0)
  return Array.from({ length: fixes }, (_, i) => ({
    lat: 28.6139 + (i * stepM) / M_PER_DEG_LAT + noise(),
    lng: 77.209 + noise(),
    accuracy: acc,
    recorded_at: new Date(T0 + i * everyMs).toISOString(),
  }))
}

test('haversine matches known geodesics within the sphere-vs-ellipsoid error', () => {
  // Spherical earth against WGS84 truth (Vincenty). ~0.3% off is inherent to the
  // formula and far below GPS noise, so it is not worth a fancier one — but a
  // regression past 0.5% would mean the formula itself broke.
  const cases = [
    [28.6139, 77.209, 28.6148, 77.209, 99.7],        // 100 m north
    [28.6139, 77.209, 28.6139, 77.22925, 1980.4],    // ~2 km east
    [18.5204, 73.8567, 19.076, 72.8777, 120138.2],   // Pune -> Mumbai
  ]
  for (const [aLat, aLng, bLat, bLng, truth] of cases) {
    const got = haversine(aLat, aLng, bLat, bLng)
    const errPct = Math.abs(got - truth) / truth * 100
    assert.ok(errPct < 0.5, `${got.toFixed(1)}m vs ${truth}m truth = ${errPct.toFixed(2)}% off`)
  }
  assert.strictEqual(haversine(28.6139, 77.209, 28.6139, 77.209), 0)
})

test('stationary radius scales with accuracy and stays clamped', () => {
  const radiusAt = (acc) => stationaryRadiusFor({ accuracy: acc }, { accuracy: acc })
  assert.strictEqual(radiusAt(5), 40, 'floor holds for pinpoint fixes')
  assert.strictEqual(radiusAt(30), 60, 'mid-range keeps the old fixed-60m behaviour')
  assert.strictEqual(radiusAt(50), 100, 'worst fix we accept gets the widest gate')
  assert.strictEqual(radiusAt(null), 60, 'unreported accuracy is assumed 30m -> 60m, i.e. old behaviour')
  // The gate is set by the WORSE fix of the pair, not an average.
  assert.strictEqual(stationaryRadiusFor({ accuracy: 5 }, { accuracy: 50 }), 100)
})

test('counts a 2km walk on good fixes', () => {
  // 41 fixes, 50m apart, every 30s.
  const { distanceMeters } = filterTrack(track({ fixes: 41, stepM: 50, acc: 10, everyMs: 30000 }))
  // Undercounts by ~1.4%: the final partial leg never clears the radius, so it
  // is dropped. Bounded by the radius, hence small on a walk this long.
  assert.ok(distanceMeters > 1900 && distanceMeters <= 2000, `got ${distanceMeters}m, want ~1973m`)
})

test('counts a 40km drive', () => {
  const { distanceMeters } = filterTrack(track({ fixes: 181, stepM: 222.2, acc: 15, everyMs: 10000 }))
  assert.ok(distanceMeters > 38000 && distanceMeters <= 39996, `got ${distanceMeters}m, want ~39396m`)
})

test('counts a slow 300m stroll — the case a fixed 60m radius swallowed', () => {
  // 1.67m per 10s. Under the old fixed 60m gate this read 240m (-20%): the
  // radius truncates the last leg, so a short walk loses a big fraction of
  // itself. A 40m gate on 12m fixes cuts that to ~-7%.
  const { distanceMeters } = filterTrack(track({ fixes: 181, stepM: 1.67, acc: 12, everyMs: 10000 }))
  assert.ok(distanceMeters > 260, `got ${distanceMeters}m, want ~280m — worse than the old 240m`)
  assert.ok(distanceMeters <= 300, `got ${distanceMeters}m — cannot exceed the 300m actually walked`)
})

test('a still phone with poor fixes logs no distance', () => {
  // +/-80m drift, honestly reported as 45m accuracy (Android reports a 68%
  // confidence radius, so real drift this wide comes with a poor number).
  // Old fixed 60m gate: 428m of phantom travel in half an hour. Now: none.
  const { distanceMeters } = filterTrack(track({ fixes: 180, stepM: 0, acc: 45, everyMs: 10000, driftM: 80 }))
  assert.strictEqual(distanceMeters, 0)
})

test('a still phone with mildly under-reported fixes logs no distance', () => {
  // Claims 15m while drifting +/-30m — why the floor is 40m and not 25m: at 25m
  // this leaks ~67m per half hour, at 40m nothing. Costs the stroll case ~16m.
  const { distanceMeters } = filterTrack(track({ fixes: 180, stepM: 0, acc: 15, everyMs: 10000, driftM: 30 }))
  assert.strictEqual(distanceMeters, 0)
})

test('KNOWN GAP: a badly-lying device still defeats the gate', () => {
  // Claims 20m while drifting +/-80m. An accuracy-derived gate can only be as
  // honest as the device, and here it is worse than the old fixed 60m (834m vs
  // 428m). Asserted so the gap stays visible and a future fix has a baseline:
  // catching this needs the noise estimated from the window's own scatter
  // rather than taken from the device's claim. Tighten this when that lands.
  const { distanceMeters } = filterTrack(track({ fixes: 180, stepM: 0, acc: 20, everyMs: 10000, driftM: 80 }))
  assert.ok(distanceMeters > 0, 'if this now reports 0m the gap is fixed — tighten this test')
})

test('a fix with no accuracy is kept, not trusted, and not given a fake number', () => {
  const pts = track({ fixes: 41, stepM: 50, acc: null, everyMs: 30000 })
  const { distanceMeters, points } = filterTrack(pts)
  // Dropping these would zero out the distance of every device that never sends
  // accuracy (Traccar hardware, older clients, /ping without the param).
  assert.ok(distanceMeters > 1900, `got ${distanceMeters}m — unreported accuracy must not be dropped`)
  // Output accuracy stays null so the Timeline shows "—", never a fabricated "±30m".
  assert.strictEqual(points[0].accuracy, null)
})

test('a malformed accuracy is dropped rather than trusted as perfect', () => {
  // 'abc' used to slip through `> MAX_ACCURACY_M` (false for NaN) and be treated
  // as a flawless fix.
  const pts = track({ fixes: 41, stepM: 50, acc: 10, everyMs: 30000 })
    .map((p, i) => (i % 2 ? { ...p, accuracy: 'abc' } : p))
  const { points } = filterTrack(pts)
  assert.ok(points.every((p) => p.accuracy === null || Number.isFinite(p.accuracy)))
})

test('fixes worse than the accuracy ceiling are dropped', () => {
  const { distanceMeters, points } = filterTrack(track({ fixes: 10, stepM: 50, acc: 999, everyMs: 30000 }))
  assert.strictEqual(distanceMeters, 0)
  assert.strictEqual(points.length, 0)
})

test('a teleport glitch is skipped without breaking the track', () => {
  const pts = track({ fixes: 10, stepM: 50, acc: 10, everyMs: 60000 })
  pts.splice(5, 0, { lat: 40.0, lng: 77.209, accuracy: 10, recorded_at: new Date(T0 + 5 * 60000 + 1000).toISOString() })
  const { distanceMeters } = filterTrack(pts)
  // ~1250km away in a minute. Counting it would swamp the day.
  assert.ok(distanceMeters < 1000, `got ${distanceMeters}m — the teleport leaked in`)
})

test('degenerate inputs return zero rather than throwing', () => {
  for (const input of [[], null, undefined, [null], [{}]]) {
    assert.deepStrictEqual(filterTrack(input), { points: [], distanceMeters: 0 })
  }
  const one = [{ lat: 28.6139, lng: 77.209, accuracy: 5, recorded_at: new Date(T0).toISOString() }]
  assert.strictEqual(filterTrack(one).distanceMeters, 0)
})

test('distance never runs backwards as fixes are added', () => {
  // Distance is a running sum, so a prefix of a track can never measure more
  // than the whole — a cheap guard against a re-anchoring bug.
  const full = track({ fixes: 60, stepM: 30, acc: 10, everyMs: 20000 })
  let prev = 0
  for (let n = 2; n <= full.length; n += 6) {
    const d = filterTrack(full.slice(0, n)).distanceMeters
    assert.ok(d >= prev, `prefix of ${n} measured ${d}m, shorter than the ${prev}m prefix before it`)
    prev = d
  }
})
