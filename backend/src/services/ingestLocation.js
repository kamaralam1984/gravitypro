// Reusable location-ingest pipeline.
//
// This factors out the exact logic that routes/locations.js performs for a phone
// position, so that hardware tracker positions (forwarded from Traccar via
// webhooks/traccar.js) flow through the SAME pipeline:
//   1. insert into device_locations
//   2. upsert user_latest_locations (newest-wins)
//   3. broadcast a location_update over SSE to the user's circles
//   4. run the geofence entry/exit check
//
// NOTE: routes/locations.js currently has its own private copy of this logic and
// is intentionally left untouched. It COULD later require('./ingestLocation') and
// delete its local saveLocation to dedupe — behaviour is identical.

const { query } = require('../config/db')
const { checkGeofenceStatus } = require('./geofence')
const { sendToCircleMembers } = require('./sse')

/**
 * Persist a single position for a user and fan out updates + geofence checks.
 *
 * @param {string} userId  - GravityPro users.id (uuid)
 * @param {object} point   - { lat, lon, altitude, accuracy, speed, bearing, battery, timestamp }
 *                           timestamp may be a JS Date, ms epoch, seconds epoch, or ISO string.
 * @returns {Promise<boolean>} true if stored, false if skipped (bad coords/time)
 */
const ingestLocation = async (userId, point) => {
  const { lat, lon, altitude, accuracy, speed, bearing, battery, timestamp } = point || {}

  const nLat = lat == null ? NaN : parseFloat(lat)
  const nLon = lon == null ? NaN : parseFloat(lon)
  if (isNaN(nLat) || isNaN(nLon)) return false

  const locationWKT = `POINT(${nLon} ${nLat})`
  const recordedAt = timestamp
    ? new Date(typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp)
    : new Date()
  if (isNaN(recordedAt.getTime())) return false

  const num = (v) => (v == null || v === '' || isNaN(parseFloat(v)) ? null : parseFloat(v))

  await query(
    `INSERT INTO device_locations (user_id, geom, accuracy, speed, bearing, altitude, battery_level, recorded_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5, $6, $7, $8)`,
    [userId, locationWKT, num(accuracy), num(speed), num(bearing), num(altitude), num(battery), recordedAt]
  )

  await query(
    `INSERT INTO user_latest_locations (user_id, geom, accuracy, battery_level, updated_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
       SET geom = EXCLUDED.geom, accuracy = EXCLUDED.accuracy,
           battery_level = EXCLUDED.battery_level, updated_at = EXCLUDED.updated_at
       WHERE user_latest_locations.updated_at < EXCLUDED.updated_at`,
    [userId, locationWKT, num(accuracy), num(battery), recordedAt]
  )

  const circlesResult = await query(
    'SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1',
    [userId]
  )
  for (const row of circlesResult.rows) {
    await sendToCircleMembers(row.circle_id, 'location_update', {
      userId,
      latitude: nLat,
      longitude: nLon,
      speed: num(speed),
      bearing: num(bearing),
      accuracy: num(accuracy),
      battery: num(battery),
      timestamp: recordedAt.toISOString(),
    }).catch(() => {})
  }

  await checkGeofenceStatus(userId, nLat, nLon)
  return true
}

module.exports = { ingestLocation }
