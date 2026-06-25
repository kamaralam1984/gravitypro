const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const { checkGeofenceStatus } = require('../services/geofence')
const { sendToCircleMembers } = require('../services/sse')
const { sendDeviceAlert, sendPushNotifications } = require('../services/alerts')

// Send a "speeding" alert to the user's circles when their GPS speed crosses the
// configured threshold, with hysteresis (device_status.speeding_alerted) so it
// fires once per over-speed episode rather than on every fix.
const SPEED_RESET_MARGIN_KMH = 10
const checkSpeeding = async (userId, speedMps, user) => {
  const limit = user?.speed_alert_kmh
  if (!limit || limit <= 0) return                       // 0/unset = disabled
  if (speedMps == null || isNaN(speedMps) || speedMps < 0) return
  const kmh = Math.round(speedMps * 3.6)
  const st = await query('SELECT speeding_alerted FROM device_status WHERE user_id = $1', [userId])
  const alerted = st.rows[0]?.speeding_alerted === true
  if (kmh > limit && !alerted) {
    await query(
      `INSERT INTO device_status (user_id, speeding_alerted, updated_at)
       VALUES ($1, true, now())
       ON CONFLICT (user_id) DO UPDATE SET speeding_alerted = true, updated_at = now()`,
      [userId]
    )
    await sendDeviceAlert(userId, 'device_alert', {
      alertType: 'speeding',
      title: 'Speeding',
      body: `Moving at ${kmh} km/h (limit ${limit} km/h).`,
      extra: { speed_kmh: kmh, limit_kmh: limit },
    }).catch(e => console.error('[users/location] speeding alert failed:', e.message))
  } else if (kmh <= limit - SPEED_RESET_MARGIN_KMH && alerted) {
    await query('UPDATE device_status SET speeding_alerted = false WHERE user_id = $1', [userId])
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  push_token: z.string().optional(),
})

const locationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  battery_level: z.number().min(0).max(100).optional(),
  speed: z.number().nullable().optional(),   // m/s from GPS; used for speeding alerts
  mode: z.string().optional(),
})

const batterySchema = z.object({
  battery_level: z.number().min(0).max(100),
})

const settingsSchema = z.object({
  share_location: z.boolean().optional(),
  notif_arrivals: z.boolean().optional(),
  notif_sos: z.boolean().optional(),
  notif_geofence: z.boolean().optional(),
  speed_alert_kmh: z.number().int().min(0).max(300).optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Save a location point for a user.
 * Mirrors locations.js saveLocation but also accepts battery_level and uses
 * latitude/longitude field names (as sent by ChildPanel).
 */
const saveUserLocation = async (userId, { latitude, longitude, accuracy, battery_level, speed }, user = null) => {
  if (latitude == null || longitude == null || isNaN(latitude) || isNaN(longitude)) return
  const locationWKT = `POINT(${parseFloat(longitude)} ${parseFloat(latitude)})`
  const recordedAt = new Date()

  // Insert into device_locations (battery_level column exists per schema)
  await query(
    `INSERT INTO device_locations (user_id, geom, accuracy, battery_level, recorded_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5)`,
    [userId, locationWKT, accuracy ?? null, battery_level ?? null, recordedAt]
  )

  // Upsert into user_latest_locations — only update if newer
  await query(
    `INSERT INTO user_latest_locations (user_id, geom, accuracy, battery_level, updated_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
       SET geom         = EXCLUDED.geom,
           accuracy     = EXCLUDED.accuracy,
           battery_level = EXCLUDED.battery_level,
           updated_at   = EXCLUDED.updated_at
       WHERE user_latest_locations.updated_at < EXCLUDED.updated_at`,
    [userId, locationWKT, accuracy ?? null, battery_level ?? null, recordedAt]
  )

  // Send SSE update to every circle this user belongs to
  try {
    const circlesResult = await query(
      'SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1',
      [userId]
    )
    for (const row of circlesResult.rows) {
      await sendToCircleMembers(row.circle_id, 'location_update', {
        userId,
        latitude,
        longitude,
        accuracy,
        battery_level,
        timestamp: recordedAt.toISOString(),
      })
    }
  } catch (sseErr) {
    // Non-fatal — SSE failure must not block the response
    console.error('[users/location] SSE error:', sseErr.message)
  }

  // Check geofences (also non-fatal)
  try {
    await checkGeofenceStatus(userId, latitude, longitude)
  } catch (geoErr) {
    console.error('[users/location] geofence error:', geoErr.message)
  }

  // Speeding alert (non-fatal) — needs the user's threshold from req.user.
  try {
    if (user) await checkSpeeding(userId, speed, user)
  } catch (spErr) {
    console.error('[users/location] speeding error:', spErr.message)
  }
}

// ─── Existing routes ──────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user })
})

// POST /api/v1/users/me/push-token — store Expo push token
router.post("/me/push-token", authenticate, async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: "token required" })
  await query("UPDATE users SET push_token = $1 WHERE id = $2", [token, req.user.id]).catch(() => {})
  res.json({ ok: true })
})

// DELETE /api/v1/users/me/push-token — clear push token (disable notifications)
router.delete("/me/push-token", authenticate, async (req, res) => {
  await query("UPDATE users SET push_token = NULL WHERE id = $1", [req.user.id]).catch(() => {})
  res.json({ ok: true })
})

router.patch('/me', authenticate, validate(updateSchema), async (req, res) => {
  const { name, email, push_token } = req.body
  try {
    const result = await query(
      `UPDATE users
         SET name       = COALESCE($1, name),
             email      = COALESCE($2, email),
             push_token = COALESCE($3, push_token),
             updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, phone, email, avatar_url, push_token, country_code`,
      [name, email, push_token, req.user.id]
    )
    res.json({ user: result.rows[0] })
  } catch (err) {
    console.error('[PATCH /me]', err.message)
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// GET /users/me/settings — privacy + notification preferences
router.get('/me/settings', authenticate, (req, res) => {
  res.json({
    settings: {
      share_location: req.user.share_location !== false,
      notif_arrivals: req.user.notif_arrivals !== false,
      notif_sos: req.user.notif_sos !== false,
      notif_geofence: req.user.notif_geofence !== false,
      speed_alert_kmh: req.user.speed_alert_kmh ?? 80,
    },
  })
})

// PATCH /users/me/settings — update privacy + notification preferences
router.patch('/me/settings', authenticate, validate(settingsSchema), async (req, res) => {
  const { share_location, notif_arrivals, notif_sos, notif_geofence, speed_alert_kmh } = req.body
  try {
    const result = await query(
      `UPDATE users SET
         share_location  = COALESCE($1, share_location),
         notif_arrivals  = COALESCE($2, notif_arrivals),
         notif_sos       = COALESCE($3, notif_sos),
         notif_geofence  = COALESCE($4, notif_geofence),
         speed_alert_kmh = COALESCE($5, speed_alert_kmh),
         updated_at = NOW()
       WHERE id = $6
       RETURNING share_location, notif_arrivals, notif_sos, notif_geofence, speed_alert_kmh`,
      [share_location ?? null, notif_arrivals ?? null, notif_sos ?? null, notif_geofence ?? null, speed_alert_kmh ?? null, req.user.id]
    )
    res.json({ settings: result.rows[0] })
  } catch (err) {
    console.error('[PATCH /me/settings]', err.message)
    res.status(500).json({ error: 'Failed to update settings' })
  }
})

// POST /users/:userId/refresh — a parent remotely refreshes a member's app:
// pushes an "app_command:refresh" so the child app pulls the latest OTA, reloads,
// and heartbeats back ONLINE without the member having to logout/login.
router.post('/:userId/refresh', authenticate, async (req, res) => {
  const targetId = req.params.userId
  if (req.user.account_type === 'child') {
    return res.status(403).json({ error: 'Only a parent can refresh a member' })
  }
  // Caller and target must share at least one circle.
  const shared = await query(
    `SELECT 1 FROM circle_members a
       JOIN circle_members b ON a.circle_id = b.circle_id
      WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
    [req.user.id, targetId]
  )
  if (!shared.rows.length) return res.status(403).json({ error: 'Member is not in your circle' })

  const tk = await query('SELECT push_token FROM users WHERE id = $1', [targetId])
  const token = tk.rows[0]?.push_token
  if (!token) return res.status(409).json({ error: 'Member device has no push token yet (ask them to open the app once)' })

  await sendPushNotifications([token], {
    title: 'Gravity',
    body: 'Refreshing & updating your app…',
    data: { type: 'app_command', command: 'refresh' },
  })
  res.json({ success: true })
})

router.get('/search', authenticate, async (req, res) => {
  const { phone } = req.query
  if (!phone) return res.status(400).json({ error: 'phone query required' })
  try {
    const result = await query(
      'SELECT id, name, phone, avatar_url FROM users WHERE phone = $1 AND id != $2',
      [phone, req.user.id]
    )
    res.json({ user: result.rows[0] || null })
  } catch (err) {
    console.error('[GET /search]', err.message)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ─── New location routes ──────────────────────────────────────────────────────

/**
 * POST /users/location
 * Body: { latitude, longitude, accuracy?, battery_level? }
 * Called by ChildPanel when the app is in the foreground.
 */
router.post('/location', authenticate, validate(locationSchema), async (req, res) => {
  const { latitude, longitude, accuracy, battery_level, speed } = req.body
  try {
    // Privacy: if the user turned OFF "Share my location", do not store or
    // broadcast their position. Respond OK so the client doesn't error/retry.
    if (req.user.share_location === false) return res.json({ success: true, shared: false })
    await saveUserLocation(req.user.id, { latitude, longitude, accuracy, battery_level, speed }, req.user)
    res.json({ success: true })
  } catch (err) {
    console.error('[POST /users/location]', err.message)
    res.status(500).json({ error: 'Failed to save location' })
  }
})

/**
 * PATCH /users/location
 * Body: { battery_level }
 * Lightweight update — only refreshes battery level without a new GPS point.
 */
router.patch('/location', authenticate, validate(batterySchema), async (req, res) => {
  const { battery_level } = req.body
  try {
    await query(
      `UPDATE user_latest_locations
         SET battery_level = $1, updated_at = NOW()
       WHERE user_id = $2`,
      [battery_level, req.user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error('[PATCH /users/location]', err.message)
    res.status(500).json({ error: 'Failed to update battery level' })
  }
})

/**
 * POST /users/heartbeat
 * No body. Keeps the user "online" while their phone is ON even when the device
 * is stationary and Android throttles / stops background GPS updates (the usual
 * reason a child showed OFFLINE despite the phone being on). Bumps the freshness
 * timestamp on the last-known location and re-broadcasts presence to circles so
 * parent panels flip the child back to ONLINE immediately.
 */
router.post('/heartbeat', authenticate, async (req, res) => {
  const userId = req.user.id
  try {
    // Respect "Share my location" OFF — no presence broadcast when sharing is disabled.
    if (req.user.share_location === false) return res.json({ success: true, shared: false })
    // Only bump freshness if we already have a last-known location for this user.
    const upd = await query(
      `UPDATE user_latest_locations
         SET updated_at = NOW()
       WHERE user_id = $1
       RETURNING ST_Y(geom) AS latitude, ST_X(geom) AS longitude, battery_level`,
      [userId]
    )
    // Keep device_status fresh too so the offline-monitor doesn't false-alert.
    await query(
      `UPDATE device_status
         SET last_location_at = NOW(), offline_alerted = false, updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    ).catch(() => {})

    const row = upd.rows[0]
    if (row && row.latitude != null && row.longitude != null) {
      try {
        const circlesResult = await query(
          'SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1',
          [userId]
        )
        for (const c of circlesResult.rows) {
          await sendToCircleMembers(c.circle_id, 'location_update', {
            userId,
            latitude: row.latitude,
            longitude: row.longitude,
            battery_level: row.battery_level,
            timestamp: new Date().toISOString(),
            heartbeat: true,
          })
        }
      } catch (sseErr) {
        console.error('[users/heartbeat] SSE error:', sseErr.message)
      }
    }
    res.json({ success: true, hadLocation: !!row })
  } catch (err) {
    console.error('[POST /users/heartbeat]', err.message)
    res.status(500).json({ error: 'Failed to heartbeat' })
  }
})

/**
 * GET /users/me/stats
 * Returns today's activity summary for the authenticated user.
 * Response: { today: { distance: number, safeZones: number, checkins: number } }
 */
router.get('/me/stats', authenticate, async (req, res) => {
  const userId = req.user.id
  try {
    // Count of distinct safe zones the user entered today
    const safeZonesResult = await query(
      `SELECT COUNT(DISTINCT safe_zone_id) AS safe_zones
         FROM geofence_events
        WHERE user_id = $1
          AND event_type = 'entry'
          AND created_at >= CURRENT_DATE
          AND created_at <  CURRENT_DATE + INTERVAL '1 day'`,
      [userId]
    )

    // Count of location points recorded today (used as "checkins")
    const checkinsResult = await query(
      `SELECT COUNT(*) AS checkins
         FROM device_locations
        WHERE user_id = $1
          AND recorded_at >= CURRENT_DATE
          AND recorded_at <  CURRENT_DATE + INTERVAL '1 day'`,
      [userId]
    )

    // Approximate total distance travelled today in metres using ST_Length
    // Cast to geography so the unit is metres, then convert to km
    const distanceResult = await query(
      `SELECT COALESCE(
         ST_Length(
           ST_MakeLine(geom::geometry ORDER BY recorded_at)::geography
         ) / 1000.0,
         0
       ) AS distance_km
         FROM device_locations
        WHERE user_id = $1
          AND recorded_at >= CURRENT_DATE
          AND recorded_at <  CURRENT_DATE + INTERVAL '1 day'`,
      [userId]
    )

    const safeZones = parseInt(safeZonesResult.rows[0]?.safe_zones ?? 0, 10)
    const checkins = parseInt(checkinsResult.rows[0]?.checkins ?? 0, 10)
    const distance = parseFloat(distanceResult.rows[0]?.distance_km ?? 0)

    res.json({
      today: {
        distance: Math.round(distance * 100) / 100, // km, 2 dp
        safeZones,
        checkins,
      },
    })
  } catch (err) {
    console.error('[GET /users/me/stats]', err.message)
    // Return zeroed stats rather than an error so the UI still renders
    res.json({ today: { distance: 0, safeZones: 0, checkins: 0 } })
  }
})

/**
 * GET /users/me/location-history
 * Returns the last 50 location points for the authenticated user.
 */
router.get('/me/location-history', authenticate, async (req, res) => {
  const userId = req.user.id
  try {
    const result = await query(
      `SELECT
           id,
           ST_Y(geom::geometry) AS latitude,
           ST_X(geom::geometry) AS longitude,
           accuracy,
           speed,
           bearing,
           altitude,
           battery_level,
           recorded_at
         FROM device_locations
        WHERE user_id = $1
        ORDER BY recorded_at DESC
        LIMIT 50`,
      [userId]
    )
    res.json({ locations: result.rows })
  } catch (err) {
    console.error('[GET /users/me/location-history]', err.message)
    res.status(500).json({ error: 'Failed to fetch location history' })
  }
})

// GET /api/v1/users/public-location?uid= — shared location link (no auth required)
router.get('/public-location', async (req, res) => {
  const { uid } = req.query
  if (!uid) return res.status(400).json({ error: 'uid required' })
  try {
    const r = await query(
      `SELECT u.name, u.avatar_url, ull.updated_at,
        ST_Y(ull.geom) as latitude, ST_X(ull.geom) as longitude, ull.battery_level
       FROM users u
       LEFT JOIN user_latest_locations ull ON ull.user_id = u.id
       WHERE u.id = $1`,
      [uid]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(r.rows[0])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/v1/users/me — delete own account
router.delete('/me', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM users WHERE id = $1', [req.user.id])
    res.json({ success: true, message: 'Account deleted. All data removed.' })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
