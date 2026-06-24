const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')

// ── Hardware tracker device pairing ────────────────────────────────────────────
// Pairs an external Traccar device (by its uniqueId / IMEI = device_uid) to a
// GravityPro user. Once paired, positions forwarded from Traccar to
// /webhooks/traccar are ingested as that user's location.

// Can `requesterId` manage devices on behalf of `targetUserId`?
//  - themselves: always
//  - a child they created (users.created_by = requester), OR
//  - a member of a circle where the requester is an 'admin'
const canManageFor = async (requesterId, targetUserId) => {
  if (requesterId === targetUserId) return true

  const child = await query(
    'SELECT 1 FROM users WHERE id = $1 AND created_by = $2',
    [targetUserId, requesterId]
  )
  if (child.rows.length) return true

  const shared = await query(
    `SELECT 1
       FROM circle_members me
       JOIN circle_members them ON them.circle_id = me.circle_id
      WHERE me.user_id = $1 AND me.role = 'admin' AND them.user_id = $2
      LIMIT 1`,
    [requesterId, targetUserId]
  )
  return shared.rows.length > 0
}

// user_ids the requester is allowed to SEE devices for (self + their circles).
const visibleUserIds = async (requesterId) => {
  const r = await query(
    `SELECT DISTINCT them.user_id
       FROM circle_members me
       JOIN circle_members them ON them.circle_id = me.circle_id
      WHERE me.user_id = $1`,
    [requesterId]
  )
  const ids = new Set(r.rows.map((row) => row.user_id))
  ids.add(requesterId)
  return [...ids]
}

// POST /devices  { device_uid, name?, type?, user_id? }
// Pairs to req.user.id, or to user_id if the requester may manage that user.
router.post('/', authenticate, async (req, res) => {
  const { device_uid, name, type, user_id } = req.body || {}
  if (!device_uid || typeof device_uid !== 'string') {
    return res.status(400).json({ error: 'device_uid required' })
  }

  const targetUserId = user_id || req.user.id
  if (user_id && !(await canManageFor(req.user.id, user_id))) {
    return res.status(403).json({ error: 'Not allowed to pair a device for that user' })
  }

  try {
    const result = await query(
      `INSERT INTO tracker_devices (user_id, device_uid, name, type)
       VALUES ($1, $2, $3, COALESCE($4, 'gps'))
       RETURNING id, user_id, device_uid, name, type, created_at`,
      [targetUserId, device_uid.trim(), name || null, type || null]
    )
    return res.status(201).json({ success: true, device: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This device is already paired' })
    }
    throw err
  }
})

// GET /devices — devices paired to me or to anyone in my circles.
router.get('/', authenticate, async (req, res) => {
  const ids = await visibleUserIds(req.user.id)
  const result = await query(
    `SELECT d.id, d.user_id, d.device_uid, d.name, d.type, d.created_at,
            u.name AS owner_name
       FROM tracker_devices d
       JOIN users u ON u.id = d.user_id
      WHERE d.user_id = ANY($1::uuid[])
      ORDER BY d.created_at DESC`,
    [ids]
  )
  return res.json({ devices: result.rows })
})

// DELETE /devices/:id — unpair. Allowed if I own it or can manage its owner.
router.delete('/:id', authenticate, async (req, res) => {
  const found = await query('SELECT id, user_id FROM tracker_devices WHERE id = $1', [req.params.id])
  if (!found.rows.length) return res.status(404).json({ error: 'Device not found' })

  if (!(await canManageFor(req.user.id, found.rows[0].user_id))) {
    return res.status(403).json({ error: 'Not allowed to remove this device' })
  }

  await query('DELETE FROM tracker_devices WHERE id = $1', [req.params.id])
  return res.json({ success: true })
})

module.exports = router
