const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { z } = require('zod')
const { query } = require('../config/db')
const { validate } = require('../middleware/validate')

const registerSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().min(2).max(100),
  email: z.string().email().optional(),
  password: z.string().min(6),
  country_code: z.enum(['KE', 'IN', 'AE', 'GB', 'US']).default('IN'),
})

const loginSchema = z.object({
  phone: z.string(),
  password: z.string(),
})

router.post('/register', validate(registerSchema), async (req, res) => {
  const { phone, name, email, password, country_code } = req.body
  const existing = await query('SELECT id FROM users WHERE phone = $1', [phone])
  if (existing.rows.length) return res.status(409).json({ error: 'Phone already registered' })
  const passwordHash = await bcrypt.hash(password, 12)
  const result = await query(
    'INSERT INTO users (phone, name, email, password_hash, country_code) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, phone, email, country_code, created_at',
    [phone, name, email || null, passwordHash, country_code]
  )
  const user = result.rows[0]
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  res.status(201).json({ user, token })
})

router.post('/login', validate(loginSchema), async (req, res) => {
  const { phone, password } = req.body
  const result = await query('SELECT id, name, phone, email, avatar_url, push_token, country_code, password_hash FROM users WHERE phone = $1', [phone])
  if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' })
  const user = result.rows[0]
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  const { password_hash, ...safeUser } = user
  res.json({ user: safeUser, token })
})

// Google OAuth — decode JWT payload without external library
function decodeGoogleToken(idToken) {
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch(e) { return null }
}

router.post('/google', async (req, res) => {
  const { id_token } = req.body
  if (!id_token) return res.status(400).json({ error: 'id_token required' })
  const payload = decodeGoogleToken(id_token)
  if (!payload || !payload.email) return res.status(400).json({ error: 'Invalid Google token' })
  const { email, name, sub: googleId } = payload
  // Find existing user by google_id or email
  let result = await query('SELECT id, name, phone, email, avatar_url, push_token, country_code FROM users WHERE google_id = $1 OR email = $2', [googleId, email])
  let user
  if (result.rows.length) {
    // Update google_id if missing
    user = result.rows[0]
    if (!user.google_id) {
      await query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]).catch(() => {})
    }
  } else {
    // Create new user (no phone, no password)
    const inserted = await query(
      'INSERT INTO users (name, email, google_id, country_code) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, email, avatar_url, push_token, country_code',
      [name || email.split('@')[0], email, googleId, 'IN']
    ).catch(async () => {
      // If google_id column missing, insert without it
      return query(
        'INSERT INTO users (name, email, country_code) VALUES ($1, $2, $3) RETURNING id, name, phone, email, avatar_url, push_token, country_code',
        [name || email.split('@')[0], email, 'IN']
      )
    })
    user = inserted.rows[0]
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  res.json({ user, token })
})

module.exports = router
