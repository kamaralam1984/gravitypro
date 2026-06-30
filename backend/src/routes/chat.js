const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { sendToCircleMembers } = require('../services/sse')

// Ensure the messages table exists on first use
const ensureTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      circle_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name TEXT,
      user_avatar TEXT,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

let tableReady = false
const withTable = async (fn) => {
  if (!tableReady) {
    await ensureTable()
    tableReady = true
  }
  return fn()
}

// GET /api/v1/chat/circle/:circleId — last 50 messages
router.get('/circle/:circleId', authenticate, async (req, res) => {
  try {
    await withTable(async () => {
      const { circleId } = req.params
      const userId = req.user.id

      // Verify user is a member of this circle
      const membership = await query(
        'SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2',
        [circleId, userId]
      )
      if (!membership.rows.length) {
        return res.status(403).json({ error: 'Not a member of this circle' })
      }

      const result = await query(
        `SELECT id, circle_id, user_id, user_name, user_avatar, text, created_at
         FROM messages
         WHERE circle_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [circleId]
      )

      // Return in chronological order (oldest first)
      const messages = result.rows.reverse()
      res.json({ messages })
    })
  } catch (err) {
    console.error('GET /chat/circle error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/v1/chat/circle/:circleId — send a message
router.post('/circle/:circleId', authenticate, async (req, res) => {
  try {
    await withTable(async () => {
      const { circleId } = req.params
      const { text } = req.body
      const userId = req.user.id

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Message text is required' })
      }

      // Verify user is a member of this circle
      const membership = await query(
        'SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2',
        [circleId, userId]
      )
      if (!membership.rows.length) {
        return res.status(403).json({ error: 'Not a member of this circle' })
      }

      const result = await query(
        `INSERT INTO messages (circle_id, user_id, user_name, user_avatar, text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, circle_id, user_id, user_name, user_avatar, text, created_at`,
        [circleId, userId, req.user.name, req.user.avatar_url || null, text.trim()]
      )

      const msg = result.rows[0]

      // Broadcast to all circle members via SSE
      await sendToCircleMembers(circleId, 'new_message', {
        id: msg.id,
        circleId: msg.circle_id,
        userId: msg.user_id,
        userName: msg.user_name,
        userAvatar: msg.user_avatar,
        text: msg.text,
        createdAt: msg.created_at,
      })

      res.status(201).json({ message: msg })
    })
  } catch (err) {
    console.error('POST /chat/circle error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
