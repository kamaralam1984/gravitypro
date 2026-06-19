const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { sendToCircleMembers } = require('../services/sse')

// POST /api/v1/sos — trigger SOS alert
router.post('/', authenticate, async (req, res) => {
  const { latitude, longitude, message } = req.body
  const userId = req.user.id
  // Get all circles this user belongs to
  const circles = await query('SELECT circle_id FROM circle_members WHERE user_id = $1', [userId])
  if (!circles.rows.length) return res.status(400).json({ error: 'Not in any circle' })
  const sosData = {
    userId,
    userName: req.user.name,
    userAvatar: req.user.avatar_url,
    latitude: latitude || null,
    longitude: longitude || null,
    message: message || 'SOS! I need help!',
    timestamp: new Date().toISOString(),
  }
  // Send SOS via SSE to all circle members
  for (const row of circles.rows) {
    await sendToCircleMembers(row.circle_id, 'sos_alert', sosData)
  }
  // Log SOS event in geofence_events table if location available
  if (latitude && longitude) {
    await query(
      `INSERT INTO device_locations (user_id, geom, recorded_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), NOW())`,
      [userId, longitude, latitude]
    ).catch(() => {}) // don't fail if table issue
  }
  res.json({ success: true, message: 'SOS sent to all circle members' })
})

// GET /api/v1/sos/history — get SOS history (placeholder)
router.get('/history', authenticate, async (req, res) => {
  res.json({ sos_events: [] })
})

module.exports = router
