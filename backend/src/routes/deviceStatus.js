// deviceStatus.js — device GPS/location-services status endpoints.
//
//   POST /api/v1/device/gps-status  { gps_enabled: boolean }
//        Upserts device_status.gps_enabled. On a true -> false transition emits
//        a GPS-OFF alert (same SSE + push delivery as geofence/sos).
//
//   GET  /api/v1/device/status
//        Returns the caller's current device_status row.

const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const { sendDeviceAlert } = require('../services/alerts')

const gpsStatusSchema = z.object({
  gps_enabled: z.boolean(),
})

// POST /device/gps-status — report whether location services are enabled.
router.post('/gps-status', authenticate, validate(gpsStatusSchema), async (req, res) => {
  const userId = req.user.id
  const { gps_enabled } = req.body
  try {
    // Single atomic statement that captures the PREVIOUS gps_enabled value
    // (via a CTE that reads the row before the upsert writes it) and performs
    // the upsert. `prev_enabled` is null when no row existed yet — in that case
    // we treat the prior state as enabled (the column default) so a brand-new
    // device reporting gps_enabled=false still produces one alert.
    const result = await query(
      `WITH prev AS (
         SELECT gps_enabled FROM device_status WHERE user_id = $1
       ), up AS (
         INSERT INTO device_status (user_id, gps_enabled, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE
           SET gps_enabled = EXCLUDED.gps_enabled,
               updated_at  = now()
         RETURNING user_id
       )
       SELECT (SELECT gps_enabled FROM prev) AS prev_enabled`,
      [userId, gps_enabled]
    )

    // prev_enabled === null -> no prior row -> default enabled (true).
    const prevEnabled = result.rows[0]?.prev_enabled ?? true

    res.json({ ok: true })

    // Fire a GPS-OFF alert only on an enabled -> disabled edge (once per off
    // episode; repeated false reports while already disabled do nothing).
    if (!gps_enabled && prevEnabled) {
      sendDeviceAlert(userId, 'device_alert', {
        alertType: 'gps_off',
        title: 'Location turned off',
        body: 'Location services were turned off on their device.',
      }).catch(e => console.error('[deviceStatus] gps_off alert failed:', e.message))
    }
  } catch (err) {
    console.error('[deviceStatus] gps-status failed:', err.message)
    if (!res.headersSent) res.status(500).json({ error: 'Failed to update gps status' })
  }
})

// GET /device/status — current device_status row for the caller.
router.get('/status', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM device_status WHERE user_id = $1', [req.user.id])
    res.json({ status: result.rows[0] || null })
  } catch (err) {
    console.error('[deviceStatus] get status failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch device status' })
  }
})

module.exports = router
