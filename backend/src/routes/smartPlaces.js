// AI Smart Places API — automatically-learned frequently-visited locations.
// Mount at /api/v1/smart-places (see app.js).
const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')

// Authorization: requester is the same user OR shares a circle with :userId
// (same pattern as routes/timeline.js).
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

const CATEGORY_ICONS = {
  home: '🏠', school: '🏫', office: '🏢', gym: '🏋', cafe: '☕',
  mosque: '🕌', church: '⛪', temple: '🛕', gurdwara: '🪯',
  hospital: '🏥', mall: '🏬', place_of_worship: '🛐',
  tuition: '📚', playground: '🛝', music: '🎵', dance: '💃',
  other: '📍', unknown: '📍',
}

const formatTimeOfDay = (sec) => {
  if (sec == null) return null
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const serializePlace = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  icon: CATEGORY_ICONS[r.category] || CATEGORY_ICONS.unknown,
  placeType: r.place_type,
  lat: Number(r.lat),
  lng: Number(r.lng),
  visitCount: r.visit_count,
  totalDurationSec: Number(r.total_duration_sec),
  longestStaySec: Number(r.longest_stay_sec),
  avgArrival: formatTimeOfDay(r.avg_arrival_sec),
  avgDeparture: formatTimeOfDay(r.avg_departure_sec),
  firstVisitAt: r.first_visit_at,
  lastVisitAt: r.last_visit_at,
  isFavorite: r.is_favorite,
  isPinned: r.is_pinned,
  customIcon: r.custom_icon,
  photoCount: Array.isArray(r.photo_ids) ? r.photo_ids.length : 0,
})

// GET /:userId?sort=visits|recent&limit=&cursor=&from=&to=&q=
router.get('/:userId', authenticate, async (req, res) => {
  const { userId } = req.params
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }

  const sort = req.query.sort === 'recent' ? 'last_visit_at DESC NULLS LAST' : 'visit_count DESC'
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
  const cursorOffset = parseInt(req.query.cursor, 10) || 0
  const from = req.query.from ? String(req.query.from) : null
  const to = req.query.to ? String(req.query.to) : null
  const q = req.query.q ? String(req.query.q).trim() : null

  if (!from || !to) {
    const params = [userId]
    let where = 'WHERE user_id = $1'
    if (q) { params.push(`%${q}%`); where += ` AND (name ILIKE $${params.length} OR category ILIKE $${params.length})` }
    params.push(limit, cursorOffset)
    const result = await query(
      `SELECT id, name, category, place_type, ST_Y(center_geom) as lat, ST_X(center_geom) as lng,
              visit_count, total_duration_sec, longest_stay_sec, avg_arrival_sec, avg_departure_sec,
              first_visit_at, last_visit_at, is_favorite, is_pinned, custom_icon, photo_ids
         FROM smart_places
         ${where}
         ORDER BY ${sort}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    return res.json({ places: result.rows.map(serializePlace), nextCursor: result.rows.length === limit ? cursorOffset + limit : null })
  }

  const params2 = [userId, from, to]
  let qClause = ''
  if (q) { params2.push(`%${q}%`); qClause = ` AND (sp.name ILIKE $${params2.length} OR sp.category ILIKE $${params2.length})` }
  const result = await query(
    `SELECT sp.id, sp.name, sp.category, sp.place_type, ST_Y(sp.center_geom) as lat, ST_X(sp.center_geom) as lng,
            COUNT(ts.id) as visit_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM (ts.departed_at - ts.arrived_at))), 0) as total_duration_sec,
            COALESCE(MAX(EXTRACT(EPOCH FROM (ts.departed_at - ts.arrived_at))), 0) as longest_stay_sec,
            sp.avg_arrival_sec, sp.avg_departure_sec,
            MIN(ts.arrived_at) as first_visit_at, MAX(ts.arrived_at) as last_visit_at,
            sp.is_favorite, sp.is_pinned, sp.custom_icon, sp.photo_ids
       FROM smart_places sp
       JOIN timeline_stops ts ON ts.smart_place_id = sp.id
      WHERE sp.user_id = $1 AND ts.arrived_at >= $2::date AND ts.arrived_at < ($3::date + INTERVAL '1 day')${qClause}
      GROUP BY sp.id
      ORDER BY visit_count DESC
      LIMIT ${limit}`,
    params2
  )
  res.json({ places: result.rows.map(serializePlace), nextCursor: null })
})

// GET /:userId/top?limit=10 — Analytics: Top N Most Visited Places.
router.get('/:userId/top', authenticate, async (req, res) => {
  const { userId } = req.params
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50)
  const result = await query(
    `SELECT id, name, category, place_type, ST_Y(center_geom) as lat, ST_X(center_geom) as lng,
            visit_count, total_duration_sec, longest_stay_sec, avg_arrival_sec, avg_departure_sec,
            first_visit_at, last_visit_at, is_favorite, is_pinned, custom_icon, photo_ids
       FROM smart_places
      WHERE user_id = $1
      ORDER BY visit_count DESC
      LIMIT $2`,
    [userId, limit]
  )
  const places = result.rows.map(serializePlace)
  const totalVisits = places.reduce((s, p) => s + p.visitCount, 0)
  const avgStaySec = places.length ? Math.round(places.reduce((s, p) => s + p.totalDurationSec, 0) / Math.max(1, totalVisits)) : 0
  const longestStaySec = places.reduce((m, p) => Math.max(m, p.longestStaySec), 0)
  res.json({ places, totalVisits, avgStaySec, longestStaySec })
})

// GET /:userId/search?q=
router.get('/:userId/search', authenticate, async (req, res) => {
  const { userId } = req.params
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ places: [] })
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  const result = await query(
    `SELECT id, name, category, place_type, ST_Y(center_geom) as lat, ST_X(center_geom) as lng,
            visit_count, total_duration_sec, longest_stay_sec, avg_arrival_sec, avg_departure_sec,
            first_visit_at, last_visit_at, is_favorite, is_pinned, custom_icon, photo_ids
       FROM smart_places
      WHERE user_id = $1 AND (name ILIKE $2 OR category ILIKE $2)
      ORDER BY visit_count DESC
      LIMIT 50`,
    [userId, `%${q}%`]
  )
  res.json({ places: result.rows.map(serializePlace) })
})

// GET /:userId/:placeId — Place Details.
router.get('/:userId/:placeId', authenticate, async (req, res) => {
  const { userId, placeId } = req.params
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  const placeResult = await query(
    `SELECT id, name, category, place_type, ST_Y(center_geom) as lat, ST_X(center_geom) as lng,
            visit_count, total_duration_sec, longest_stay_sec, avg_arrival_sec, avg_departure_sec,
            first_visit_at, last_visit_at, is_favorite, is_pinned, custom_icon, photo_ids
       FROM smart_places WHERE id = $1 AND user_id = $2`,
    [placeId, userId]
  )
  if (!placeResult.rows.length) return res.status(404).json({ error: 'Smart Place not found' })

  const weeklyResult = await query(
    `SELECT to_char(date_trunc('week', arrived_at), 'YYYY-MM-DD') as week, COUNT(*) as visits
       FROM timeline_stops
      WHERE smart_place_id = $1 AND arrived_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY 1 ORDER BY 1`,
    [placeId]
  )
  const monthlyResult = await query(
    `SELECT to_char(date_trunc('month', arrived_at), 'YYYY-MM') as month, COUNT(*) as visits
       FROM timeline_stops
      WHERE smart_place_id = $1 AND arrived_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1`,
    [placeId]
  )

  res.json({
    place: serializePlace(placeResult.rows[0]),
    weeklyVisits: weeklyResult.rows.map((r) => ({ week: r.week, visits: Number(r.visits) })),
    monthlyVisits: monthlyResult.rows.map((r) => ({ month: r.month, visits: Number(r.visits) })),
  })
})

// GET /:userId/:placeId/visits?from=&to=&limit=&cursor=
router.get('/:userId/:placeId/visits', authenticate, async (req, res) => {
  const { userId, placeId } = req.params
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100)
  const cursor = req.query.cursor ? new Date(String(req.query.cursor)) : null
  const from = req.query.from ? String(req.query.from) : null
  const to = req.query.to ? String(req.query.to) : null

  const params = [placeId, userId]
  let where = 'WHERE ts.smart_place_id = $1 AND ts.user_id = $2'
  if (from) { params.push(from); where += ` AND ts.arrived_at >= $${params.length}::date` }
  if (to) { params.push(to); where += ` AND ts.arrived_at < ($${params.length}::date + INTERVAL '1 day')` }
  if (cursor) { params.push(cursor); where += ` AND ts.arrived_at < $${params.length}` }
  params.push(limit)

  const result = await query(
    `SELECT ts.id, ts.arrived_at, ts.departed_at, ST_Y(ts.center_geom) as lat, ST_X(ts.center_geom) as lng
       FROM timeline_stops ts
       ${where}
      ORDER BY ts.arrived_at DESC
      LIMIT $${params.length}`,
    params
  )
  const visits = result.rows.map((r) => ({
    id: r.id,
    arrivedAt: r.arrived_at,
    departedAt: r.departed_at,
    durationSec: r.departed_at ? Math.round((new Date(r.departed_at) - new Date(r.arrived_at)) / 1000) : null,
    lat: Number(r.lat),
    lng: Number(r.lng),
  }))
  const nextCursor = visits.length === limit ? visits[visits.length - 1].arrivedAt : null
  res.json({ visits, nextCursor })
})

module.exports = router
