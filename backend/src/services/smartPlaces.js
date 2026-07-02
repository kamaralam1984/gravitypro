const { query } = require('../config/db')

// Promotion thresholds — a Smart Place is only created once there's real
// evidence, never from a single visit.
const MIN_VISITS = 5
const MIN_TOTAL_HOURS = 5
const CLUSTER_RADIUS_M = 100

// Direct OSM tag → category mapping. A strong signal, used ahead of the
// weaker time-of-day heuristic whenever a categoryHint is available.
// (safe_zones.category values — home/school/tuition/playground/music/dance —
// pass straight through unmapped since they're already in our vocabulary.)
const TAG_CATEGORY_MAP = {
  hospital: 'hospital', clinic: 'hospital', doctors: 'hospital', pharmacy: 'hospital',
  school: 'school', college: 'school', university: 'school', kindergarten: 'school',
  cafe: 'cafe', restaurant: 'cafe', fast_food: 'cafe',
  fitness_centre: 'gym', sports_centre: 'gym', gym: 'gym',
  mall: 'mall', marketplace: 'mall', department_store: 'mall', supermarket: 'mall',
  'place_of_worship:muslim': 'mosque',
  'place_of_worship:christian': 'church',
  'place_of_worship:hindu': 'temple',
  'place_of_worship:sikh': 'gurdwara',
  place_of_worship: 'place_of_worship',
}

const secondsSinceMidnight = (d) => {
  const date = new Date(d)
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
}

/**
 * Heuristic-only category inference (no AI API) from a set of visits
 * ({arrivedAt, departedAt}) plus any category hints collected from those
 * visits (OSM tags, or the parent's own safe_zones.category — see
 * timelineStops.js). Direct hint matches win when present; otherwise falls
 * back to time-of-day/day-of-week pattern scoring.
 */
const inferCategory = (visits, categoryHints) => {
  const hintCounts = {}
  for (const hint of categoryHints) {
    if (!hint) continue
    const mapped = TAG_CATEGORY_MAP[hint] || hint // pass through safe_zones.category values as-is
    hintCounts[mapped] = (hintCounts[mapped] || 0) + 1
  }
  const hintEntries = Object.entries(hintCounts)
  if (hintEntries.length) {
    hintEntries.sort((a, b) => b[1] - a[1])
    return hintEntries[0][0]
  }

  const n = visits.length
  if (n === 0) return 'unknown'
  let nightStays = 0, schoolPattern = 0, officePattern = 0, gymPattern = 0, weekendPattern = 0

  for (const v of visits) {
    const arr = new Date(v.arrivedAt)
    const dep = v.departedAt ? new Date(v.departedAt) : new Date()
    const arrHour = arr.getHours()
    const depHour = dep.getHours()
    const day = arr.getDay()
    const isWeekend = day === 0 || day === 6
    const durationHr = Math.max(0, (dep.getTime() - arr.getTime()) / 3600000)

    if ((arrHour >= 20 || arrHour < 5) && durationHr > 4) nightStays++
    if (!isWeekend && arrHour >= 6 && arrHour <= 9 && depHour >= 12 && depHour <= 16) schoolPattern++
    if (!isWeekend && arrHour >= 8 && arrHour <= 10 && depHour >= 17 && depHour <= 19) officePattern++
    if (arrHour >= 17 && arrHour <= 21 && durationHr >= 0.5 && durationHr <= 2) gymPattern++
    if (isWeekend && durationHr >= 0.5) weekendPattern++
  }

  const scores = {
    home: nightStays / n,
    school: schoolPattern / n,
    office: officePattern / n,
    gym: gymPattern / n,
    mall: weekendPattern / n,
  }
  const [bestCategory, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return bestScore >= 0.5 ? bestCategory : 'other'
}

/** Incrementally folds one newly-linked visit into a Smart Place's rolling stats. */
const updatePlaceStats = async (placeId, arrivedAt, departedAt) => {
  const durationSec = Math.max(0, Math.round((new Date(departedAt) - new Date(arrivedAt)) / 1000))
  const arrivalSec = secondsSinceMidnight(arrivedAt)
  const departureSec = secondsSinceMidnight(departedAt)

  await query(
    `UPDATE smart_places SET
       visit_count        = visit_count + 1,
       total_duration_sec = total_duration_sec + $2,
       longest_stay_sec   = GREATEST(longest_stay_sec, $2),
       avg_arrival_sec    = COALESCE(((avg_arrival_sec * visit_count) + $3) / (visit_count + 1), $3),
       avg_departure_sec  = COALESCE(((avg_departure_sec * visit_count) + $4) / (visit_count + 1), $4),
       first_visit_at     = LEAST(COALESCE(first_visit_at, $5), $5),
       last_visit_at      = GREATEST(COALESCE(last_visit_at, $5), $5),
       updated_at         = NOW()
     WHERE id = $1`,
    [placeId, durationSec, arrivalSec, departureSec, arrivedAt]
  )
}

/** Re-runs category inference from a place's full (bounded, indexed) visit set. */
const refreshCategory = async (placeId) => {
  const visitsResult = await query(
    'SELECT arrived_at, departed_at, category_hint FROM timeline_stops WHERE smart_place_id = $1',
    [placeId]
  )
  const visits = visitsResult.rows.map((r) => ({ arrivedAt: r.arrived_at, departedAt: r.departed_at }))
  const hints = visitsResult.rows.map((r) => r.category_hint)
  const category = inferCategory(visits, hints)
  await query('UPDATE smart_places SET category = $2, updated_at = NOW() WHERE id = $1', [placeId, category])
}

/**
 * Main entry point — called after a timeline_stop closes and its place name
 * has been resolved (see services/timelineStops.js). Either links the stop
 * to an existing Smart Place, promotes a new one once enough evidence exists
 * across nearby unlinked stops, or leaves it unlinked as a "candidate."
 *
 * Every query is scoped to this one user and bounded by a spatial (GIST) or
 * partial index — never a full-history scan, regardless of data volume.
 */
const processStopForSmartPlaces = async (userId, stopId, lat, lng, arrivedAt, departedAt, placeName, placeType, safeZoneId, categoryHint) => {
  const existing = await query(
    `SELECT id FROM smart_places
      WHERE user_id = $1
        AND ST_DWithin(center_geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, radius_m)
      ORDER BY ST_Distance(center_geom, ST_SetSRID(ST_MakePoint($2, $3), 4326))
      LIMIT 1`,
    [userId, lng, lat]
  )

  if (existing.rows.length) {
    const placeId = existing.rows[0].id
    await query('UPDATE timeline_stops SET smart_place_id = $1 WHERE id = $2', [placeId, stopId])
    await updatePlaceStats(placeId, arrivedAt, departedAt)
    await refreshCategory(placeId)
    return
  }

  const candidates = await query(
    `SELECT id, arrived_at, departed_at, category_hint, ST_Y(center_geom) as lat, ST_X(center_geom) as lng
       FROM timeline_stops
      WHERE user_id = $1 AND smart_place_id IS NULL AND departed_at IS NOT NULL
        AND ST_DWithin(center_geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)`,
    [userId, lng, lat, CLUSTER_RADIUS_M]
  )

  const visitCount = candidates.rows.length
  const totalDurationSec = candidates.rows.reduce(
    (sum, c) => sum + Math.max(0, (new Date(c.departed_at) - new Date(c.arrived_at)) / 1000), 0
  )

  if (visitCount < MIN_VISITS && totalDurationSec < MIN_TOTAL_HOURS * 3600) {
    return
  }

  const avgLat = candidates.rows.reduce((s, c) => s + Number(c.lat), 0) / visitCount
  const avgLng = candidates.rows.reduce((s, c) => s + Number(c.lng), 0) / visitCount
  const visits = candidates.rows.map((c) => ({ arrivedAt: c.arrived_at, departedAt: c.departed_at }))
  const hints = candidates.rows.map((c) => c.category_hint)
  const category = inferCategory(visits, hints)

  const insertResult = await query(
    `INSERT INTO smart_places (user_id, center_geom, name, place_type, category, category_hint, safe_zone_id, radius_m)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, avgLng, avgLat, placeName || 'Unknown area', placeType || 'unknown', category, categoryHint || null, safeZoneId || null, CLUSTER_RADIUS_M]
  )
  const placeId = insertResult.rows[0].id

  for (const c of candidates.rows) {
    await query('UPDATE timeline_stops SET smart_place_id = $1 WHERE id = $2', [placeId, c.id])
    await updatePlaceStats(placeId, c.arrived_at, c.departed_at)
  }
}

module.exports = { processStopForSmartPlaces, inferCategory, MIN_VISITS, MIN_TOTAL_HOURS, CLUSTER_RADIUS_M }
