const { query } = require('../config/db')
const { resolvePlaceName } = require('./geocoding')
const { processStopForSmartPlaces } = require('./smartPlaces')

// Defaults per spec: 100m stay radius, minimum 10 minute stay to confirm a stop.
const STOP_RADIUS_M = 100
const MIN_STAY_MS = 10 * 60 * 1000

/**
 * Finds the safe zone (if any) containing a point. Used at stop-close time
 * against the stop's own averaged centroid — safe-zone name always wins over
 * a geocoded name (never overridden by road/area name). Also returns the
 * zone's parent-assigned `category` (home/school/tuition/playground/music/
 * dance/other, see migrations/012_zone_assignment.sql) — a stronger Smart
 * Places category signal than any heuristic, since it's the parent's own
 * explicit labelling.
 */
const findContainingZone = async (lat, lng) => {
  const wkt = `POINT(${lng} ${lat})`
  const result = await query(
    `SELECT sz.id, sz.name, sz.category
     FROM safe_zones sz
     WHERE ST_Contains(sz.geom, ST_SetSRID(ST_GeomFromText($1), 4326))
     LIMIT 1`,
    [wkt]
  )
  return result.rows[0] || null
}

/**
 * Resolves the closed stop's display name in the background (fire-and-forget
 * from the caller's perspective) and writes it once resolved. Kept out of
 * the request/response path so LocationIQ latency never delays a location
 * POST — see saveUserLocation() in routes/users.js.
 *
 * Once the name is known, hands the closed stop to Smart Places clustering
 * (services/smartPlaces.js) — that step also needs a resolved name in case
 * it ends up promoting a brand-new place.
 */
const resolveAndUpdateStopName = async (stop, closedAt, lat, lng) => {
  let placeName, placeType, safeZoneId = null, categoryHint = null
  try {
    const zone = await findContainingZone(lat, lng)
    if (zone) {
      placeName = zone.name
      placeType = 'safe_zone'
      safeZoneId = zone.id
      // A safe zone's own category (set by the parent) is authoritative —
      // passed straight through as the category_hint for Smart Places.
      categoryHint = zone.category && zone.category !== 'other' ? zone.category : null
      await query(
        `UPDATE timeline_stops
         SET place_name = $2, place_type = 'safe_zone', safe_zone_id = $3, safe_zone_name = $2, category_hint = $4
         WHERE id = $1`,
        [stop.id, zone.name, zone.id, categoryHint]
      )
    } else {
      const resolved = await resolvePlaceName(lat, lng)
      placeName = resolved.name
      placeType = resolved.type
      categoryHint = resolved.categoryHint
      await query(
        `UPDATE timeline_stops SET place_name = $2, place_type = $3, address = $4, category_hint = $5 WHERE id = $1`,
        [stop.id, resolved.name, resolved.type, resolved.address, categoryHint]
      )
    }
  } catch (err) {
    console.error('[timelineStops] resolveAndUpdateStopName failed:', err.message)
    return
  }

  try {
    await processStopForSmartPlaces(stop.user_id, stop.id, lat, lng, stop.arrived_at, closedAt, placeName, placeType, safeZoneId, categoryHint)
  } catch (err) {
    console.error('[timelineStops] processStopForSmartPlaces failed:', err.message)
  }
}

const closeStop = async (stop, closedAt) => {
  const durationMs = new Date(closedAt).getTime() - new Date(stop.arrived_at).getTime()
  if (durationMs < MIN_STAY_MS) {
    await query('DELETE FROM timeline_stops WHERE id = $1', [stop.id])
    return
  }
  await query('UPDATE timeline_stops SET departed_at = $2 WHERE id = $1', [stop.id, closedAt])
  const centroid = await query('SELECT ST_Y(center_geom) as lat, ST_X(center_geom) as lng FROM timeline_stops WHERE id = $1', [stop.id])
  const { lat, lng } = centroid.rows[0]
  resolveAndUpdateStopName(stop, closedAt, lat, lng).catch(() => {})
}

/**
 * Closes any stop left "open" because location updates simply stopped
 * arriving (device offline/killed) — the normal close path in
 * trackStopForLocation only fires when a NEW point arrives outside the
 * radius, which never happens in that case. Called by a periodic cron
 * (see jobs/index.js).
 */
const closeStaleStops = async () => {
  const stale = await query(
    `SELECT * FROM timeline_stops WHERE departed_at IS NULL AND last_point_at < NOW() - INTERVAL '30 minutes'`
  )
  for (const stop of stale.rows) {
    await closeStop(stop, stop.last_point_at)
  }
  return stale.rows.length
}

// The caller checks for an open stop and then inserts one, which is a race: two
// location ingests for the same user arriving together (background task and
// foreground, or a retry) both see no open stop and both insert, and one loses
// to idx_timeline_stops_open_per_user. That surfaced in prod as recurring
// "duplicate key value violates unique constraint" errors from the ingest path.
//
// Losing that race is not an error worth failing on — the winner opened a stop
// at the same place a moment earlier, which is exactly what this one wanted. Let
// the loser no-op. ON CONFLICT has to restate the index's WHERE clause for
// Postgres to infer the partial index.
const openNewStop = async (userId, lat, lng, at) => {
  await query(
    `INSERT INTO timeline_stops (user_id, center_geom, arrived_at, last_point_at, point_count, radius_m)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $4, 1, $5)
     ON CONFLICT (user_id) WHERE departed_at IS NULL DO NOTHING`,
    [userId, lng, lat, at, STOP_RADIUS_M]
  )
}

/**
 * Incremental stop detection, run inline on every location ingest. Tracks at
 * most one "open" stop per user (enforced by a partial unique index) — no
 * full-history rescan is ever needed.
 */
const trackStopForLocation = async (userId, lat, lng, recordedAt) => {
  const openResult = await query('SELECT * FROM timeline_stops WHERE user_id = $1 AND departed_at IS NULL', [userId])
  const open = openResult.rows[0]

  if (!open) {
    await openNewStop(userId, lat, lng, recordedAt)
    return
  }

  const distanceResult = await query(
    `SELECT ST_DWithin(center_geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4) as within
     FROM timeline_stops WHERE id = $1`,
    [open.id, lng, lat, open.radius_m]
  )
  const within = distanceResult.rows[0]?.within

  if (within) {
    await query(
      `UPDATE timeline_stops
       SET center_geom = ST_SetSRID(ST_MakePoint(
             (ST_X(center_geom) * point_count + $2) / (point_count + 1),
             (ST_Y(center_geom) * point_count + $3) / (point_count + 1)
           ), 4326),
           point_count = point_count + 1,
           last_point_at = $4
       WHERE id = $1`,
      [open.id, lng, lat, recordedAt]
    )
    return
  }

  await closeStop(open, recordedAt)
  await openNewStop(userId, lat, lng, recordedAt)
}

module.exports = { trackStopForLocation, closeStaleStops, STOP_RADIUS_M, MIN_STAY_MS }
