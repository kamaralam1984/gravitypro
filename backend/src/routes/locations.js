const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { checkGeofenceStatus } = require('../services/geofence')
const { sendToCircleMembers } = require('../services/sse')
const { sendDeviceAlert } = require('../services/alerts')

// Battery thresholds for the BATTERY-LOW alert (with hysteresis so we don't spam).
const BATTERY_LOW_THRESHOLD = 15
const BATTERY_RESET_THRESHOLD = 25

// Upsert device_status on every accepted location update and emit a battery-low
// alert when the device crosses below the threshold. Also clears offline_alerted
// since a fresh location just arrived (see services/deviceMonitor.js).
const updateDeviceStatus = async (userId, point, recordedAt) => {
  // Mobile location service sends battery as `battery` or `battery_level`.
  const rawBattery = point.battery ?? point.battery_level ?? null
  const battery =
    rawBattery != null && !isNaN(rawBattery)
      ? Math.max(0, Math.min(100, Math.round(rawBattery)))
      : null

  const result = await query(
    `INSERT INTO device_status (user_id, last_location_at, last_battery, offline_alerted, updated_at)
     VALUES ($1, $2, $3, false, now())
     ON CONFLICT (user_id) DO UPDATE
       SET last_location_at = EXCLUDED.last_location_at,
           last_battery     = COALESCE(EXCLUDED.last_battery, device_status.last_battery),
           offline_alerted  = false,
           updated_at       = now()
     RETURNING last_battery, battery_low_alerted`,
    [userId, recordedAt, battery]
  )

  if (battery == null) return
  const row = result.rows[0] || {}

  if (battery <= BATTERY_LOW_THRESHOLD && !row.battery_low_alerted) {
    await sendDeviceAlert(userId, 'device_alert', {
      alertType: 'battery_low',
      title: 'Low battery',
      body: `Battery at ${battery}%. Their device may shut down soon.`,
      extra: { battery },
    }).catch(e => console.error('[locations] battery alert failed:', e.message))
    await query('UPDATE device_status SET battery_low_alerted = true WHERE user_id = $1', [userId])
  } else if (battery >= BATTERY_RESET_THRESHOLD && row.battery_low_alerted) {
    await query('UPDATE device_status SET battery_low_alerted = false WHERE user_id = $1', [userId])
  }
}

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

  // Track device health (battery-low alert + offline-flag reset). Best-effort —
  // never block or fail a location save on monitoring.
  try {
    await updateDeviceStatus(userId, point, recordedAt)
  } catch (e) {
    console.error('[locations] updateDeviceStatus failed:', e.message)
  }
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
