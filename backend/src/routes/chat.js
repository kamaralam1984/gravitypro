const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { sendToCircleMembers } = require('../services/sse')

const VALID_TYPES = ['text', 'image', 'location', 'voice']

// Ensure the caller is a member of the circle. Returns true if allowed.
const isMember = async (circleId, userId) => {
  const r = await query(
    'SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2',
    [circleId, userId]
  )
  return r.rows.length > 0
}

// Fetch a single message joined with its sender's name/avatar.
const fetchMessage = async (id) => {
  const r = await query(
    `SELECT m.id, m.circle_id, m.sender_id,
            u.name AS sender_name, u.avatar_url AS sender_avatar,
            m.type, m.text, m.media_url, m.lat, m.lng, m.duration_sec, m.created_at
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = $1`,
    [id]
  )
  return r.rows[0]
}

// GET /chat/:circleId?before=<ISO>&limit=50  -> { messages: [...] } oldest->newest
router.get('/:circleId', authenticate, async (req, res) => {
  const { circleId } = req.params
  if (!(await isMember(circleId, req.user.id))) {
    return res.status(403).json({ error: 'Access denied' })
  }

  let limit = parseInt(req.query.limit, 10)
  if (!Number.isFinite(limit) || limit <= 0) limit = 50
  if (limit > 200) limit = 200

  const before = req.query.before
  const params = [circleId]
  let where = 'm.circle_id = $1'
  if (before) {
    params.push(before)
    where += ` AND m.created_at < $${params.length}`
  }
  params.push(limit)

  // Pull newest `limit` rows (so `before` paginates backwards), then re-order ascending.
  const r = await query(
    `SELECT * FROM (
       SELECT m.id, m.circle_id, m.sender_id,
              u.name AS sender_name, u.avatar_url AS sender_avatar,
              m.type, m.text, m.media_url, m.lat, m.lng, m.duration_sec, m.created_at
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE ${where}
       ORDER BY m.created_at DESC
       LIMIT $${params.length}
     ) sub
     ORDER BY sub.created_at ASC`,
    params
  )
  res.json({ messages: r.rows })
})

// POST /chat/:circleId  { type, text?, media_url?, lat?, lng?, duration_sec? }
// Inserts the message, then SSE-broadcasts 'chat_message' to all circle members.
router.post('/:circleId', authenticate, async (req, res) => {
  const { circleId } = req.params
  if (!(await isMember(circleId, req.user.id))) {
    return res.status(403).json({ error: 'Access denied' })
  }

  const { type, text, media_url, lat, lng, duration_sec } = req.body || {}
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid type. Use text, image, location, or voice.' })
  }
  if (type === 'text' && (!text || !String(text).trim())) {
    return res.status(400).json({ error: 'text is required for text messages' })
  }
  if ((type === 'image' || type === 'voice') && !media_url) {
    return res.status(400).json({ error: 'media_url is required for image and voice messages' })
  }
  if (type === 'location' && (lat == null || lng == null)) {
    return res.status(400).json({ error: 'lat and lng are required for location messages' })
  }

  const inserted = await query(
    `INSERT INTO chat_messages (circle_id, sender_id, type, text, media_url, lat, lng, duration_sec)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      circleId,
      req.user.id,
      type,
      text != null ? text : null,
      media_url != null ? media_url : null,
      lat != null ? lat : null,
      lng != null ? lng : null,
      duration_sec != null ? duration_sec : null,
    ]
  )

  const message = await fetchMessage(inserted.rows[0].id)

  // Broadcast to every member of the circle (including the sender, for multi-device).
  await sendToCircleMembers(circleId, 'chat_message', message)

  res.json({ message })
})

module.exports = router
