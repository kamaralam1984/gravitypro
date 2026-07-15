// Location Timeline API (Google-Maps-Timeline style)
// Mount at /api/v1/timeline (see app.js).
const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { classifyRoute } = require('../services/speedClassifier')
const { filterTrack } = require('../services/gpsFilter')
const { snapDistanceMeters } = require('../services/routing')

// ---- Tunable clustering params ----
const STAY_RADIUS_M = 150 // points within this distance are part of same stay cluster
const MIN_STAY_MS = 5 * 60 * 1000 // a cluster must span >= 5 min to count as a STAY
const MAX_RANGE_DAYS = 31 // Travel Timeline route endpoint — bounds raw-point payload size

// ---- Geo helpers ----
const R = 6371000 // earth radius (m)
const toRad = (d) => (d * Math.PI) / 180

function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// ---- Road-snapped daily distance ----
// Summing haversine between fixes measures the CHORDS of a path, so every bend
// on a road is cut across and a drive always reads short. For travel that was
// actually on roads, OSRM's own road length is the better number.
//
// Only vehicle-class segments are snapped. A walk must NOT be: someone cutting
// through a park or a gali is not on the road graph, and a driving-profile snap
// would reroute them the long way round and invent distance. Cycling is left
// alone for the same reason — cycles use paths the car network does not have.
const SNAPPABLE_MODES = new Set(['vehicle', 'highspeed'])

/**
 * Total distance for a day's already-filtered track, road-snapping the parts
 * that were driven. Falls back to the chord sum per-segment, so a dead OSRM (or
 * a region outside the extract) just reproduces the old number rather than
 * failing the request.
 */
const snappedDistanceForTrack = async (clean) => {
  if (!clean || clean.length < 2) return 0

  const forClassify = clean.map((p) => ({
    lat: p.lat, lng: p.lng, speed: p.speed,
    ts: new Date(p.recorded_at).getTime(),
  }))
  const segments = classifyRoute(forClassify)
  // classifyRoute needs >=2 points to produce anything; with none, the chord sum
  // over the whole track is all we have.
  if (!segments.length) return Math.round(chordSum(clean, 0, clean.length - 1))

  let total = 0
  // Once OSRM has failed on this request, stop asking. Every further attempt
  // would pay the same timeout for the same answer while the user waits.
  let osrmUsable = true

  for (const seg of segments) {
    const chord = chordSum(clean, seg.fromIdx, seg.toIdx)
    if (!SNAPPABLE_MODES.has(seg.mode) || !osrmUsable) {
      total += chord
      continue
    }
    const snapped = await snapDistanceMeters(clean.slice(seg.fromIdx, seg.toIdx + 1))
    if (snapped == null) {
      osrmUsable = false
      total += chord
    } else {
      total += snapped
    }
  }
  return Math.round(total)
}

const chordSum = (pts, fromIdx, toIdx) => {
  let d = 0
  for (let i = fromIdx + 1; i <= toIdx && i < pts.length; i++) {
    d += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
  }
  return d
}

// Authorization: a user can always view their own data. Viewing someone
// ELSE's data additionally requires the requester to be a parent account —
// this is directional, not symmetric: a parent may view any child sharing a
// circle with them, but a child may never view a parent's or sibling's data,
// even though they share the same circle. (Previously this only checked
// "do we share a circle," which let any co-member view any other co-member's
// Timeline/Places/Reports — including a child viewing a parent or sibling.)
// Shared by routes/places.js and routes/reports.js (they require() this
// function) and routes/smartPlaces.js — every Timeline/Places/Reports/Smart
// Places endpoint gets this fix from one place.
async function canView(requesterId, targetId) {
  if (requesterId === targetId) return true

  const requester = await query('SELECT account_type FROM users WHERE id = $1', [requesterId])
  if (requester.rows[0]?.account_type !== 'parent') return false

  const r = await query(
    `SELECT 1
       FROM circle_members a
       JOIN circle_members b ON a.circle_id = b.circle_id
      WHERE a.user_id = $1 AND b.user_id = $2
      LIMIT 1`,
    [requesterId, targetId]
  )
  return r.rows.length > 0
}

// GET /:userId/days?month=YYYY-MM
// distinct local dates in `month` that have any location points for that user
router.get('/:userId/days', authenticate, async (req, res) => {
  const { userId } = req.params
  const month = String(req.query.month || '')
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be YYYY-MM' })
  }
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  // Sargable range predicate (month + '-01' as the range start) instead of
  // to_char(recorded_at, 'YYYY-MM') = $2, which can't use the recorded_at
  // index — the DISTINCT day list itself still needs to_char() to format
  // output, but that no longer gates which rows get scanned.
  const result = await query(
    `SELECT DISTINCT to_char(recorded_at, 'YYYY-MM-DD') AS day
       FROM device_locations
      WHERE user_id = $1
        AND recorded_at >= ($2 || '-01')::date
        AND recorded_at < (($2 || '-01')::date + INTERVAL '1 month')
      ORDER BY day`,
    [userId, month]
  )
  res.json({ days: result.rows.map((r) => r.day) })
})

// ---- Core per-day computation (reused by /reports) ----
// Computes the ordered STAY/TRIP segments + summary for one user/day.
// Returns { date, segments, summary }. Does NOT do auth — callers must.
// Each `stay` segment carries place/zoneId/category (category from safe_zones).
async function computeDay(userId, date) {
  const zeros = { totalDistanceMeters: 0, placesVisited: 0, movingSec: 0, stillSec: 0 }

  // Fetch the day's ordered points (lat/lng + timestamp). Uses a sargable
  // range predicate (matches /summary and /route below) instead of
  // to_char(recorded_at, ...) = $2, which can't use the recorded_at index.
  const ptsRes = await query(
    `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lng, recorded_at,
            EXTRACT(EPOCH FROM recorded_at) * 1000 AS ts
       FROM device_locations
      WHERE user_id = $1
        AND recorded_at >= $2::date AND recorded_at < ($2::date + INTERVAL '1 day')
      ORDER BY recorded_at ASC`,
    [userId, date]
  )
  const points = ptsRes.rows.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lng),
    ts: Number(r.ts),
    iso: new Date(Number(r.ts)).toISOString(),
  }))

  if (points.length === 0) {
    return { date, segments: [], summary: { ...zeros } }
  }

  // ---- Cluster consecutive points within STAY_RADIUS_M into candidate stays ----
  // A new point joins the current cluster if it is within STAY_RADIUS_M of the
  // running centroid; otherwise it starts a new cluster.
  const clusters = []
  let cur = null
  for (const p of points) {
    if (cur && haversine(cur.cLat, cur.cLng, p.lat, p.lng) <= STAY_RADIUS_M) {
      cur.points.push(p)
      const n = cur.points.length
      cur.cLat = (cur.cLat * (n - 1) + p.lat) / n
      cur.cLng = (cur.cLng * (n - 1) + p.lng) / n
    } else {
      cur = { points: [p], cLat: p.lat, cLng: p.lng }
      clusters.push(cur)
    }
  }

  // A cluster is a STAY only if it spans >= MIN_STAY_MS. Otherwise its points
  // are pass-through movement and get folded into trips.
  const isStay = (c) =>
    c.points[c.points.length - 1].ts - c.points[0].ts >= MIN_STAY_MS

  // Load safe zones (with polygon centroid) for the target user's circles, so we
  // can name each stay by its nearest zone and tell if the centroid is inside it.
  const zonesRes = await query(
    `SELECT DISTINCT sz.id, sz.name, sz.category,
            ST_Y(ST_Centroid(sz.geom)) AS clat,
            ST_X(ST_Centroid(sz.geom)) AS clng,
            sz.geom
       FROM safe_zones sz
       JOIN circle_members cm ON cm.circle_id = sz.circle_id
      WHERE cm.user_id = $1`,
    [userId]
  )
  // For "inside" we use the actual polygon containment via PostGIS per-stay below,
  // but keep centroids in JS for nearest-distance ranking.
  const zones = zonesRes.rows.map((z) => ({
    id: z.id,
    name: z.name,
    category: z.category || null,
    clat: Number(z.clat),
    clng: Number(z.clng),
  }))

  // Nearest zone (by centroid distance, pure JS) for each stay centroid, plus
  // true polygon containment for all of them in ONE batched query — instead
  // of nearestZone() issuing its own ST_Contains query per stay, which meant
  // one extra DB round-trip per stay cluster in the day.
  async function nearestZonesBatch(centroids) {
    if (!zones.length) return centroids.map(() => ({ place: 'Unknown', zoneId: null, category: null, inside: false }))
    const nearest = centroids.map(({ lat, lng }) => {
      let best = null
      let bestD = Infinity
      for (const z of zones) {
        const d = haversine(lat, lng, z.clat, z.clng)
        if (d < bestD) {
          bestD = d
          best = z
        }
      }
      return best
    })
    const candidates = []
    nearest.forEach((z, i) => { if (z) candidates.push({ i, lat: centroids[i].lat, lng: centroids[i].lng, zoneId: z.id }) })
    const insideByIndex = new Map()
    if (candidates.length) {
      const values = candidates.map((_, k) => `($${k * 4 + 1}::int, $${k * 4 + 2}::float8, $${k * 4 + 3}::float8, $${k * 4 + 4}::uuid)`).join(',')
      const params = candidates.flatMap((c) => [c.i, c.lng, c.lat, c.zoneId])
      const r = await query(
        `SELECT v.idx, ST_Contains(sz.geom, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)) AS inside
           FROM (VALUES ${values}) AS v(idx, lng, lat, zone_id)
           JOIN safe_zones sz ON sz.id = v.zone_id`,
        params
      )
      for (const row of r.rows) insideByIndex.set(row.idx, !!row.inside)
    }
    return centroids.map((_, i) => {
      const best = nearest[i]
      return {
        place: best ? best.name : 'Unknown',
        zoneId: best ? best.id : null,
        category: best ? best.category : null,
        inside: best ? !!insideByIndex.get(i) : false,
      }
    })
  }

  // ---- Build ordered segments: stays, with trips between them ----
  const stayClusters = clusters.filter(isStay)

  // Helper: sum Haversine distance across an inclusive slice of the points array.
  function pathDistance(arr) {
    let d = 0
    for (let i = 1; i < arr.length; i++) {
      d += haversine(arr[i - 1].lat, arr[i - 1].lng, arr[i].lat, arr[i].lng)
    }
    return d
  }

  const segments = []
  let totalDistance = 0
  let movingSec = 0
  let stillSec = 0

  if (stayClusters.length === 0) {
    // No qualifying stay: the whole day is one trip across all points.
    if (points.length >= 2) {
      const dist = pathDistance(points)
      const durSec = Math.round((points[points.length - 1].ts - points[0].ts) / 1000)
      totalDistance += dist
      movingSec += durSec
      segments.push({
        type: 'trip',
        fromLat: points[0].lat,
        fromLng: points[0].lng,
        toLat: points[points.length - 1].lat,
        toLng: points[points.length - 1].lng,
        startedAt: points[0].iso,
        endedAt: points[points.length - 1].iso,
        durationSec: durSec,
        distanceMeters: Math.round(dist),
      })
    }
  } else {
    // index ranges in `points` for each stay cluster (clusters are contiguous)
    let cursor = 0
    const stayRanges = []
    for (const c of clusters) {
      const start = cursor
      const end = cursor + c.points.length - 1
      cursor = end + 1
      if (isStay(c)) stayRanges.push({ start, end, cluster: c })
    }

    // One batched nearest-zone/containment lookup for every stay in the day,
    // instead of one inside the loop below per stay.
    const stayNz = await nearestZonesBatch(stayRanges.map((sr) => ({ lat: sr.cluster.cLat, lng: sr.cluster.cLng })))

    let prevStayEnd = null // index in points of the previous stay's last point
    for (let si = 0; si < stayRanges.length; si++) {
      const sr = stayRanges[si]

      // TRIP from previous stay (or day start) up to this stay's start
      const tripFromIdx = prevStayEnd == null ? 0 : prevStayEnd
      const tripToIdx = sr.start
      if (prevStayEnd != null && tripToIdx > tripFromIdx) {
        const slice = points.slice(tripFromIdx, tripToIdx + 1)
        const dist = pathDistance(slice)
        const durSec = Math.round((slice[slice.length - 1].ts - slice[0].ts) / 1000)
        totalDistance += dist
        movingSec += durSec
        segments.push({
          type: 'trip',
          fromLat: slice[0].lat,
          fromLng: slice[0].lng,
          toLat: slice[slice.length - 1].lat,
          toLng: slice[slice.length - 1].lng,
          startedAt: slice[0].iso,
          endedAt: slice[slice.length - 1].iso,
          durationSec: durSec,
          distanceMeters: Math.round(dist),
        })
      }

      // STAY
      const c = sr.cluster
      const arrive = c.points[0]
      const leave = c.points[c.points.length - 1]
      const durSec = Math.round((leave.ts - arrive.ts) / 1000)
      stillSec += durSec
      const nz = stayNz[si]
      segments.push({
        type: 'stay',
        lat: c.cLat,
        lng: c.cLng,
        place: nz.inside ? nz.place : 'Unknown',
        zoneId: nz.inside ? nz.zoneId : null,
        category: nz.inside ? nz.category : null,
        arrive: arrive.iso,
        leave: leave.iso,
        durationSec: durSec,
        pointCount: c.points.length,
      })

      prevStayEnd = sr.end
    }
  }

  const summary = {
    totalDistanceMeters: Math.round(totalDistance),
    placesVisited: segments.filter((s) => s.type === 'stay').length,
    movingSec,
    stillSec,
  }

  return { date, segments, summary }
}

// GET /:userId?date=YYYY-MM-DD
// ordered sequence of STAYS and TRIPS for the day + totals summary
router.get('/:userId', authenticate, async (req, res) => {
  const { userId } = req.params
  const date = String(req.query.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  const result = await computeDay(userId, date)
  res.json(result)
})

// GET /:userId/stops?from=&to=&limit=&cursor=
// Paginated Smart Timeline stop cards, read directly from the persisted
// timeline_stops table (see services/timelineStops.js) — no raw-point
// clustering happens on this path, so it stays fast at any history size.
router.get('/:userId/stops', authenticate, async (req, res) => {
  const { userId } = req.params
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' })
  }
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
  const cursor = req.query.cursor ? new Date(String(req.query.cursor)) : null

  // Overlap with the [from, to] window, not just "started inside it" — a
  // stop that began the night before `from` and hasn't departed yet (e.g.
  // still asleep at home) would otherwise vanish entirely from every day
  // after the one it started on, even though the user is there the whole time.
  const result = await query(
    `SELECT id, ST_Y(center_geom) as lat, ST_X(center_geom) as lng,
            arrived_at, departed_at, point_count, place_name, place_type,
            address, safe_zone_id, safe_zone_name, photo_ids
       FROM timeline_stops
      WHERE user_id = $1
        AND arrived_at < ($3::date + INTERVAL '1 day')
        AND (departed_at IS NULL OR departed_at >= $2::date)
        AND ($4::timestamptz IS NULL OR arrived_at < $4)
      ORDER BY arrived_at DESC
      LIMIT $5`,
    [userId, from, to, cursor, limit]
  )

  const stops = result.rows.map((r) => {
    const departedAt = r.departed_at || new Date()
    const durationSec = Math.max(0, Math.round((new Date(departedAt) - new Date(r.arrived_at)) / 1000))
    return {
      id: r.id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      placeName: r.place_name || r.safe_zone_name || 'Resolving…',
      placeType: r.place_type || 'unknown',
      address: r.address,
      arrivedAt: r.arrived_at,
      departedAt: r.departed_at,
      current: r.departed_at === null,
      durationSec,
      pointCount: r.point_count,
      safeZoneId: r.safe_zone_id,
      photoCount: Array.isArray(r.photo_ids) ? r.photo_ids.length : 0,
      videoCount: 0,
    }
  })

  const nextCursor = stops.length === limit ? stops[stops.length - 1].arrivedAt : null
  res.json({ stops, nextCursor })
})

// GET /:userId/route?from=&to=&simplify=&limit=&cursor=
// Bounded polyline + point-detail delivery, built for both the wide-range
// map overview (simplify mode) and single-day Route Replay/detail (raw mode).
router.get('/:userId/route', authenticate, async (req, res) => {
  const { userId } = req.params
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' })
  }
  const spanDays = (new Date(to) - new Date(from)) / 86400000
  if (spanDays < 0 || spanDays > MAX_RANGE_DAYS) {
    return res.status(400).json({ error: `date range must be between 0 and ${MAX_RANGE_DAYS} days` })
  }
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }

  const simplifyMeters = req.query.simplify ? parseFloat(String(req.query.simplify)) : null

  if (simplifyMeters && simplifyMeters > 0) {
    const result = await query(
      `SELECT ST_AsGeoJSON(ST_Simplify(ST_MakeLine(geom ORDER BY recorded_at), $4)) as line
         FROM device_locations
        WHERE user_id = $1 AND recorded_at >= $2::date AND recorded_at < ($3::date + INTERVAL '1 day')`,
      [userId, from, to, simplifyMeters / 111320]
    )
    const lineJson = result.rows[0]?.line
    const coords = lineJson ? (JSON.parse(lineJson).coordinates || []) : []
    const points = coords.map(([lng, lat]) => ({ lat, lng }))
    return res.json({
      from, to, simplified: true,
      points,
      start: points[0] || null,
      end: points[points.length - 1] || null,
      segments: [],
    })
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 20000)
  const cursor = req.query.cursor ? new Date(String(req.query.cursor)) : null

  const result = await query(
    `SELECT ST_Y(geom) as lat, ST_X(geom) as lng, accuracy, speed, bearing, altitude, recorded_at,
            EXTRACT(EPOCH FROM recorded_at) * 1000 as ts
       FROM device_locations
      WHERE user_id = $1
        AND recorded_at >= $2::date
        AND recorded_at < ($3::date + INTERVAL '1 day')
        AND ($4::timestamptz IS NULL OR recorded_at > $4)
      ORDER BY recorded_at ASC
      LIMIT $5`,
    [userId, from, to, cursor, limit]
  )

  const points = result.rows.map((r) => ({
    lat: Number(r.lat), lng: Number(r.lng),
    accuracy: r.accuracy, speed: r.speed, bearing: r.bearing, altitude: r.altitude,
    ts: Number(r.ts), recordedAt: r.recorded_at,
  }))
  // Drop GPS noise (bad-accuracy fixes, teleport glitches, stationary jitter)
  // so the drawn route follows real travel instead of a crisscross web.
  // nextCursor stays based on the RAW fetch so pagination is unaffected.
  const nextCursor = points.length === limit ? points[points.length - 1].recordedAt : null
  const clean = filterTrack(points.map((p) => Object.assign({}, p, { recorded_at: p.recordedAt }))).points
  const segments = classifyRoute(clean)

  res.json({
    from, to, simplified: false,
    points: clean.map((p) => ({
      lat: p.lat, lng: p.lng, ts: p.recordedAt,
      speed: p.speed, bearing: p.bearing, altitude: p.altitude, accuracy: p.accuracy,
    })),
    start: clean[0] ? { lat: clean[0].lat, lng: clean[0].lng, ts: clean[0].recordedAt } : null,
    end: clean[clean.length - 1] ? { lat: clean[clean.length - 1].lat, lng: clean[clean.length - 1].lng, ts: clean[clean.length - 1].recordedAt } : null,
    segments,
    nextCursor,
  })
})

// GET /:userId/summary?date=YYYY-MM-DD
// Daily Summary card data: total distance, travel time, stopped time,
// number of stops, and the ordered list of places visited.
router.get('/:userId/summary', authenticate, async (req, res) => {
  const { userId } = req.params
  const date = String(req.query.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }

  // Overlap with the day, not "started during it" — a stop that began the
  // night before and hasn't departed yet (e.g. still asleep at home) would
  // otherwise be invisible to every day after the one it started on.
  const stopsResult = await query(
    `SELECT place_name, safe_zone_name, arrived_at, departed_at
       FROM timeline_stops
      WHERE user_id = $1
        AND arrived_at < ($2::date + INTERVAL '1 day')
        AND (departed_at IS NULL OR departed_at >= $2::date)
      ORDER BY arrived_at ASC`,
    [userId, date]
  )
  // Day boundaries as real UTC instants (IST midnight), so a stop that
  // spans past midnight only counts its portion that actually falls on
  // this day toward stoppedSec — not its full multi-day duration.
  const dayStart = new Date(`${date}T00:00:00+05:30`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  let stoppedSec = 0
  const placesVisited = stopsResult.rows.map((r) => {
    const arrivedAt = new Date(r.arrived_at)
    const departedAt = r.departed_at ? new Date(r.departed_at) : new Date()
    const clippedStart = arrivedAt < dayStart ? dayStart : arrivedAt
    const clippedEnd = departedAt > dayEnd ? dayEnd : departedAt
    stoppedSec += Math.max(0, Math.round((clippedEnd - clippedStart) / 1000))
    return { name: r.place_name || r.safe_zone_name || 'Unknown', arrivedAt: r.arrived_at, departedAt: r.departed_at }
  })

  // Distance from FILTERED fixes, not raw ST_MakeLine — a stationary phone's GPS
  // jitter otherwise inflates this to absurd values (e.g. 74 km "walked" in an
  // hour). Fetch the day's points and let gpsFilter drop noise + sum real travel.
  const ptsResult = await query(
    `SELECT ST_Y(geom) as lat, ST_X(geom) as lng, accuracy, speed, recorded_at
       FROM device_locations
      WHERE user_id = $1 AND recorded_at >= $2::date AND recorded_at < ($2::date + INTERVAL '1 day')
      ORDER BY recorded_at ASC`,
    [userId, date]
  )
  const dayPts = ptsResult.rows.map((r) => ({
    lat: Number(r.lat), lng: Number(r.lng), accuracy: r.accuracy,
    speed: r.speed != null ? Number(r.speed) : null,
    recorded_at: r.recorded_at,
  }))
  const clean = filterTrack(dayPts).points
  const totalDistanceMeters = await snappedDistanceForTrack(clean)
  const firstTs = dayPts.length ? dayPts[0].recorded_at : null
  const lastTs = dayPts.length ? dayPts[dayPts.length - 1].recorded_at : null
  const spanSec = firstTs && lastTs
    ? Math.round((new Date(lastTs) - new Date(firstTs)) / 1000)
    : 0
  const travelSec = Math.max(0, spanSec - stoppedSec)

  res.json({
    date,
    totalDistanceMeters,
    travelSec,
    stoppedSec,
    stopsCount: placesVisited.length,
    placesVisited,
  })
})

module.exports = router
// Reusable helpers for other routes (e.g. /reports).
module.exports.computeDay = computeDay
module.exports.canView = canView
