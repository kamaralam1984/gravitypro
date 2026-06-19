const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { checkGeofenceStatus } = require('../services/geofence')
const { sendToCircleMembers } = require('../services/sse')

const saveLocation = async (userId, point) => {
  const { lat, lon, altitude, accuracy, speed, bearing, timestamp } = point
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return
  const locationWKT = `POINT(${parseFloat(lon)} ${parseFloat(lat)})`
  const recordedAt = timestamp ? new Date(typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp) : new Date()
  if (isNaN(recordedAt.getTime())) return

  await query(
    `INSERT INTO device_locations (user_id, geom, accuracy, speed, bearing, altitude, recorded_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5, $6, $7)`,
    [userId, locationWKT, accuracy ?? null, speed ?? null, bearing ?? null, altitude ?? null, recordedAt]
  )

  await query(
    `INSERT INTO user_latest_locations (user_id, geom, accuracy, updated_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET geom = EXCLUDED.geom, accuracy = EXCLUDED.accuracy, updated_at = EXCLUDED.updated_at
       WHERE user_latest_locations.updated_at < EXCLUDED.updated_at`,
    [userId, locationWKT, accuracy ?? null, recordedAt]
  )

  const circlesResult = await query(
    'SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1',
    [userId]
  )
  for (const row of circlesResult.rows) {
    await sendToCircleMembers(row.circle_id, 'location_update', {
      userId, latitude: lat, longitude: lon, speed, bearing, accuracy,
      timestamp: recordedAt.toISOString(),
    })
  }

  await checkGeofenceStatus(userId, lat, lon)
}

// Single location — online foreground fallback
router.post('/', authenticate, async (req, res) => {
  const { lat, lon, altitude, accuracy, speed, bearing, timestamp } = req.body
  if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' })
  await saveLocation(req.user.id, { lat, lon, altitude, accuracy, speed, bearing, timestamp })
  res.json({ success: true })
})

// Batch sync — offline queue flush
router.post('/batch', authenticate, async (req, res) => {
  const { locations } = req.body
  if (!Array.isArray(locations) || !locations.length) {
    return res.status(400).json({ error: 'locations array required' })
  }
  if (locations.length > 500) return res.status(400).json({ error: 'Max 500 per batch' })

  const sorted = locations.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  let saved = 0
  for (const point of sorted) {
    try {
      await saveLocation(req.user.id, point)
      saved++
    } catch (e) {
      console.error('[locations/batch] failed point:', e.message)
    }
  }

  res.json({ success: true, saved, total: locations.length })
})

module.exports = router
