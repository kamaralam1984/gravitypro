// Location Timeline API (Google-Maps-Timeline style)
// Mount at /api/v1/timeline (see app.js).
const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')

// ---- Tunable clustering params ----
const STAY_RADIUS_M = 150 // points within this distance are part of same stay cluster
const MIN_STAY_MS = 5 * 60 * 1000 // a cluster must span >= 5 min to count as a STAY

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

// Authorization: requester is the same user OR shares a circle with :userId
async function canView(requesterId, targetId) {
  if (requesterId === targetId) return true
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
    return res.json({ date, segments: [], summary: { ...zeros } })
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
    `SELECT DISTINCT sz.id, sz.name,
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
    clat: Number(z.clat),
    clng: Number(z.clng),
  }))

  async function nearestZone(lat, lng) {
    if (!zones.length) return { place: 'Unknown', zoneId: null, inside: false }
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
    return { place: best ? best.name : 'Unknown', zoneId: best ? best.id : null, inside }
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

  res.json({ date, segments, summary })
})

module.exports = router
