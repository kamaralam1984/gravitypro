const router = require('express').Router()
const { query } = require('../config/db')
const { checkGeofenceStatus } = require('../services/geofence')
const { sendToCircleMembers } = require('../services/sse')

router.post('/location', async (req, res) => {
  const secret = req.headers['x-traccar-secret']
  if (secret !== process.env.TRACCAR_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { deviceId, lat, lon, speed, course, altitude, accuracy, attributes } = req.body
  if (!deviceId || lat == null || lon == null) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  const userResult = await query('SELECT id FROM users WHERE phone = $1', [deviceId])
  if (!userResult.rows.length) return res.status(404).json({ error: 'Device not found' })
  const userId = userResult.rows[0].id
  const locationWKT = `POINT(${lon} ${lat})`
  await query(
    `INSERT INTO device_locations (user_id, geom, accuracy, speed, bearing, altitude, battery_level, recorded_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5, $6, $7, NOW())`,
    [userId, locationWKT, accuracy, speed, course, altitude, attributes?.batteryLevel || null]
  )
  await query(
    `INSERT INTO user_latest_locations (user_id, geom, accuracy, battery_level, updated_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE SET geom = EXCLUDED.geom, accuracy = EXCLUDED.accuracy,
     battery_level = EXCLUDED.battery_level, updated_at = NOW()`,
    [userId, locationWKT, accuracy, attributes?.batteryLevel || null]
  )
  const circlesResult = await query('SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1', [userId])
  for (const row of circlesResult.rows) {
    await sendToCircleMembers(row.circle_id, 'location_update', {
      userId, latitude: lat, longitude: lon, speed, bearing: course, accuracy,
      battery_level: attributes?.batteryLevel, timestamp: new Date().toISOString()
    })
  }
  await checkGeofenceStatus(userId, lat, lon)
  res.json({ success: true })
})

module.exports = router
