// checkins.js — Check-In feature.
//
// A member taps a preset ("I'm Home", "Reached School", "Reached Tuition",
// "Reached Office", "Reached Safely"). We persist the check-in, then deliver it
// to every other member of the relevant circle(s) using the SAME plumbing as
// geofence/SOS/device alerts:
//   1. SSE broadcast — event name 'checkin' — via sse.sendToCircleMembers().
//   2. Expo push — via the shared services/alerts.sendPushNotifications() helper
//      (same exp.host endpoint geofence.js uses).
//
// Mounted at /api/v1/checkins (see app.js).

const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const { sendToCircleMembers } = require('../services/sse')
const { sendPushNotifications } = require('../services/alerts')

// type is constrained to the known presets but free text is allowed too.
const createCheckinSchema = z.object({
  circle_id: z.string().uuid().optional(),
  type: z.string().min(1).max(40),
  message: z.string().max(200).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
})

// POST /checkins  { circle_id?, type, message?, lat?, lng? }
// Persists one row per relevant circle, then SSE + push to the other members.
router.post('/', authenticate, validate(createCheckinSchema), async (req, res) => {
  const userId = req.user.id
  const { circle_id, type, message, lat, lng } = req.body

  // Resolve the target circle(s): the explicit circle_id (membership-checked)
  // or every circle the user belongs to.
  let circleIds
  if (circle_id) {
    const membership = await query(
      'SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2',
      [circle_id, userId]
    )
    if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })
    circleIds = [circle_id]
  } else {
    const circles = await query(
      'SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1',
      [userId]
    )
    circleIds = circles.rows.map(r => r.circle_id)
  }

  if (!circleIds.length) return res.status(400).json({ error: 'You are not in any circle' })

  const userRow = await query('SELECT name FROM users WHERE id = $1', [userId])
  const userName = userRow.rows[0]?.name || 'Someone'
  const text = message || 'checked in'
  const title = `${userName}: ${text}`

  const inserted = []
  for (const cid of circleIds) {
    const row = await query(
      `INSERT INTO checkins (user_id, circle_id, type, message, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, circle_id, type, message, lat, lng, created_at`,
      [userId, cid, type, message || null, lat ?? null, lng ?? null]
    )
    inserted.push(row.rows[0])

    // SSE payload — mirror the device-alert shape so the Alerts feed can read it.
    const payload = {
      ...row.rows[0],
      event_type: 'checkin',
      checkin_type: type,
      name: userName,
      user_name: userName,
      title,
      body: text,
      timestamp: row.rows[0].created_at,
    }
    await sendToCircleMembers(cid, 'checkin', payload).catch(() => {})
  }

  // Expo push to every OTHER member of those circles.
  try {
    const tokens = await query(
      `SELECT DISTINCT u.push_token
         FROM circle_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.circle_id = ANY($1)
          AND u.push_token IS NOT NULL
          AND u.id != $2`,
      [circleIds, userId]
    )
    await sendPushNotifications(
      tokens.rows.map(t => t.push_token),
      {
        title,
        body: text,
        data: { event_type: 'checkin', checkin_type: type, userId, name: userName },
      }
    )
  } catch (err) {
    console.error('[checkins] push lookup failed:', err.message)
  }

  res.status(201).json({ checkins: inserted })
})

// GET /checkins/circle/:circleId?limit=  — recent check-ins for a circle.
// Member-gated, mirroring geofences.js GET /circle/:circleId.
router.get('/circle/:circleId', authenticate, async (req, res) => {
  const membership = await query(
    'SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2',
    [req.params.circleId, req.user.id]
  )
  if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })

  let limit = parseInt(req.query.limit, 10)
  if (!Number.isFinite(limit) || limit <= 0) limit = 50
  if (limit > 200) limit = 200

  const result = await query(
    `SELECT ch.id, ch.user_id, ch.circle_id, ch.type, ch.message,
            ch.lat, ch.lng, ch.created_at,
            u.name AS user_name, u.avatar_url
       FROM checkins ch
       JOIN users u ON u.id = ch.user_id
      WHERE ch.circle_id = $1
      ORDER BY ch.created_at DESC
      LIMIT $2`,
    [req.params.circleId, limit]
  )
  res.json({ checkins: result.rows })
})

module.exports = router
