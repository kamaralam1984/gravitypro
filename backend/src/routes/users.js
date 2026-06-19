const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  push_token: z.string().optional(),
})

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user })
})

router.patch('/me', authenticate, validate(updateSchema), async (req, res) => {
  const { name, email, push_token } = req.body
  const result = await query(
    'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), push_token = COALESCE($3, push_token), updated_at = NOW() WHERE id = $4 RETURNING id, name, phone, email, avatar_url, push_token, country_code',
    [name, email, push_token, req.user.id]
  )
  res.json({ user: result.rows[0] })
})

router.get('/search', authenticate, async (req, res) => {
  const { phone } = req.query
  if (!phone) return res.status(400).json({ error: 'phone query required' })
  const result = await query('SELECT id, name, phone, avatar_url FROM users WHERE phone = $1 AND id != $2', [phone, req.user.id])
  res.json({ user: result.rows[0] || null })
})

module.exports = router
