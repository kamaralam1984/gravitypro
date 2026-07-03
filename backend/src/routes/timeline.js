// Location Timeline API (Google-Maps-Timeline style)
// Mount at /api/v1/timeline (see app.js).
const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { classifyRoute } = require('../services/speedClassifier')

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
  const result = await query(
    `SELECT DISTINCT to_char(recorded_at, 'YYYY-MM-DD') AS day
       FROM device_locations
      WHERE user_id = $1
        AND to_char(recorded_at, 'YYYY-MM') = $2
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

  // Fetch the day's ordered points (lat/lng + timestamp)
  const ptsRes = await query(
    `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lng, recorded_at,
            EXTRACT(EPOCH FROM recorded_at) * 1000 AS ts
       FROM device_locations
      WHERE user_id = $1
        AND to_char(recorded_at, 'YYYY-MM-DD') = $2
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

  async function nearestZone(lat, lng) {
    if (!zones.length) return { place: 'Unknown', zoneId: null, category: null, inside: false }
    let best = null
    let bestD = Infinity
    for (const z of zones) {
      const d = haversine(lat, lng, z.clat, z.clng)
      if (d < bestD) {
        bestD = d
        best = z
      }
    }
    // Determine "inside" by true polygon containment in PostGIS.
    let inside = false
    if (best) {
      const r = await query(
        `SELECT ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS inside
           FROM safe_zones WHERE id = $3`,
        [lng, lat, best.id]
      )
      inside = !!(r.rows[0] && r.rows[0].inside)
    }
    return {
      place: best ? best.name : 'Unknown',
      zoneId: best ? best.id : null,
      category: best ? best.category : null,
      inside,
    }
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
      const nz = await nearestZone(c.cLat, c.cLng)
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

  const result = await query(
    `SELECT id, ST_Y(center_geom) as lat, ST_X(center_geom) as lng,
            arrived_at, departed_at, point_count, place_name, place_type,
            address, safe_zone_id, safe_zone_name, photo_ids
       FROM timeline_stops
      WHERE user_id = $1
        AND arrived_at >= $2::date
        AND arrived_at < ($3::date + INTERVAL '1 day')
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
  const segments = classifyRoute(points)
  const nextCursor = points.length === limit ? points[points.length - 1].recordedAt : null

  res.json({
    from, to, simplified: false,
    points: points.map((p) => ({
      lat: p.lat, lng: p.lng, ts: p.recordedAt,
      speed: p.speed, bearing: p.bearing, altitude: p.altitude, accuracy: p.accuracy,
    })),
    start: points[0] ? { lat: points[0].lat, lng: points[0].lng, ts: points[0].recordedAt } : null,
    end: points[points.length - 1] ? { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng, ts: points[points.length - 1].recordedAt } : null,
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

  const stopsResult = await query(
    `SELECT place_name, safe_zone_name, arrived_at, departed_at
       FROM timeline_stops
      WHERE user_id = $1 AND arrived_at >= $2::date AND arrived_at < ($2::date + INTERVAL '1 day')
      ORDER BY arrived_at ASC`,
    [userId, date]
  )
  let stoppedSec = 0
  const placesVisited = stopsResult.rows.map((r) => {
    const departedAt = r.departed_at || new Date()
    stoppedSec += Math.max(0, Math.round((new Date(departedAt) - new Date(r.arrived_at)) / 1000))
    return { name: r.place_name || r.safe_zone_name || 'Unknown', arrivedAt: r.arrived_at, departedAt: r.departed_at }
  })

  const distanceResult = await query(
    `SELECT COALESCE(ST_Length(ST_MakeLine(geom ORDER BY recorded_at)::geography), 0) as distance_m,
            MIN(recorded_at) as first_ts, MAX(recorded_at) as last_ts
       FROM device_locations
      WHERE user_id = $1 AND recorded_at >= $2::date AND recorded_at < ($2::date + INTERVAL '1 day')`,
    [userId, date]
  )
  const row = distanceResult.rows[0]
  const totalDistanceMeters = Math.round(parseFloat(row.distance_m) || 0)
  const spanSec = row.first_ts && row.last_ts
    ? Math.round((new Date(row.last_ts) - new Date(row.first_ts)) / 1000)
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
