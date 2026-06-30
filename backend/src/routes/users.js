const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const { checkGeofenceStatus } = require('../services/geofence')
const { sendToCircleMembers } = require('../services/sse')

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
  is_charging: z.boolean().optional(),
})

const batterySchema = z.object({
  battery_level: z.number().min(0).max(100),
  is_charging: z.boolean().optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Save a location point for a user.
 * Mirrors locations.js saveLocation but also accepts battery_level and uses
 * latitude/longitude field names (as sent by ChildPanel).
 */
const saveUserLocation = async (userId, { latitude, longitude, accuracy, battery_level, is_charging }) => {
  if (latitude == null || longitude == null || isNaN(latitude) || isNaN(longitude)) return
  const locationWKT = `POINT(${parseFloat(longitude)} ${parseFloat(latitude)})`
  const recordedAt = new Date()

  await query(
    `INSERT INTO device_locations (user_id, geom, accuracy, battery_level, is_charging, recorded_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5, $6)`,
    [userId, locationWKT, accuracy ?? null, battery_level ?? null, is_charging ?? false, recordedAt]
  )

  await query(
    `INSERT INTO user_latest_locations (user_id, geom, accuracy, battery_level, is_charging, updated_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromText($2), 4326), $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE
       SET geom          = EXCLUDED.geom,
           accuracy      = EXCLUDED.accuracy,
           battery_level = EXCLUDED.battery_level,
           is_charging   = EXCLUDED.is_charging,
           updated_at    = EXCLUDED.updated_at
       WHERE user_latest_locations.updated_at < EXCLUDED.updated_at`,
    [userId, locationWKT, accuracy ?? null, battery_level ?? null, is_charging ?? false, recordedAt]
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
        is_charging,
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
  const { latitude, longitude, accuracy, battery_level, is_charging } = req.body
  try {
    await saveUserLocation(req.user.id, { latitude, longitude, accuracy, battery_level, is_charging })
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
  const { battery_level, is_charging } = req.body
  try {
    await query(
      `UPDATE user_latest_locations
         SET battery_level = $1, is_charging = COALESCE($2, is_charging), updated_at = NOW()
       WHERE user_id = $3`,
      [battery_level, is_charging ?? null, req.user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error('[PATCH /users/location]', err.message)
    res.status(500).json({ error: 'Failed to update battery level' })
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

/**
 * POST /users/speed-alert
 * Body: { speed_kmh, latitude, longitude }
 * Called by the mobile background task when the device is moving faster than
 * 60 km/h.  Sends a high-priority push notification to all parents in every
 * circle this user belongs to.
 */
router.post('/speed-alert', authenticate, async (req, res) => {
  const { speed_kmh, latitude, longitude } = req.body
  const userId = req.user.id
  try {
    // Get all circles this user belongs to
    const circles = await query('SELECT circle_id FROM circle_members WHERE user_id = $1', [userId])
    if (!circles.rows.length) return res.json({ ok: true })

    // Collect push tokens from all parents in those circles (excluding the sender)
    const tokens = await query(
      `SELECT DISTINCT u.push_token FROM circle_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.circle_id = ANY($1) AND u.push_token IS NOT NULL AND u.id != $2 AND u.role = 'parent'`,
      [circles.rows.map(r => r.circle_id), userId]
    )

    if (tokens.rows.length) {
      const messages = tokens.rows.map(t => ({
        to: t.push_token,
        title: '🚗 Speed Alert',
        body: `${req.user.name} is driving at ${Math.round(speed_kmh)} km/h`,
        data: { type: 'speed_alert', latitude, longitude, speed_kmh },
        sound: 'default',
        priority: 'high',
      }))
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[POST /users/speed-alert]', e.message)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
