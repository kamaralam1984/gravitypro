const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { z } = require('zod')
const { query } = require('../config/db')
const { validate } = require('../middleware/validate')
const crypto = require('crypto')

// ── OTP helpers ──────────────────────────────────────────
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function sendSMS(phone, otp) {
  // MSG91 integration — set MSG91_AUTH_KEY + MSG91_TEMPLATE_ID in .env to enable
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) {
    try {
      const https = require('https')
      const body = JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID,
        short_url: '0',
        mobiles: phone.replace(/[^0-9]/g, ''),
        var1: otp,
      })
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.msg91.com',
          path: '/api/v5/otp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'authkey': process.env.MSG91_AUTH_KEY,
          },
        }, (r) => { r.resume(); resolve() })
        req.on('error', reject)
        req.write(body)
        req.end()
      })
      return true
    } catch (e) {
      console.error('MSG91 send failed:', e.message)
    }
  }
  // Dev fallback — log OTP to console
  console.log(`[OTP] ${phone} → ${otp}`)
  return false
}

// POST /auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body
  if (!phone || phone.trim().length < 7) {
    return res.status(400).json({ error: 'Valid phone number required' })
  }
  const cleanPhone = phone.trim()

  // Rate limit: max 3 OTPs per phone in 10 minutes
  const recent = await query(
    `SELECT COUNT(*) FROM phone_otps WHERE phone = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [cleanPhone]
  )
  if (parseInt(recent.rows[0].count) >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Wait 10 minutes.' })
  }

  // Invalidate old OTPs
  await query(`UPDATE phone_otps SET used = TRUE WHERE phone = $1 AND used = FALSE`, [cleanPhone])

  const otp = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min
  await query(
    `INSERT INTO phone_otps (phone, code, expires_at) VALUES ($1, $2, $3)`,
    [cleanPhone, otp, expiresAt]
  )

  const smsSent = await sendSMS(cleanPhone, otp)

  res.json({
    success: true,
    sms_sent: smsSent,
    // Return OTP when no SMS was sent so testers can use without real SMS service
    ...(!smsSent && { dev_otp: otp }),
  })
})

// POST /auth/verify-otp  (login via OTP only — no password)
router.post('/verify-otp', async (req, res) => {
  const { phone, otp } = req.body
  if (!phone || !otp) return res.status(400).json({ error: 'phone and otp required' })

  const result = await query(
    `SELECT id FROM phone_otps
     WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone.trim(), otp.trim()]
  )
  if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' })

  // Mark used
  await query(`UPDATE phone_otps SET used = TRUE WHERE id = $1`, [result.rows[0].id])

  // Find or create user
  let userResult = await query(
    `SELECT id, name, phone, email, avatar_url, push_token, country_code, account_type
     FROM users WHERE phone = $1`,
    [phone.trim()]
  )

  if (!userResult.rows.length) {
    return res.status(404).json({ error: 'No account found. Please register first.' })
  }

  const user = userResult.rows[0]
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  res.json({ user, token })
})

// ── Schemas ───────────────────────────────────────────────
const registerSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().min(2).max(100),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  otp: z.string().length(6),
  country_code: z.enum(['KE', 'IN', 'AE', 'GB', 'US', 'PK']).default('IN'),
  account_type: z.enum(['parent', 'child']).default('parent'),
})

const loginSchema = z.object({
  phone: z.string(),
  password: z.string(),
  otp: z.string().length(6),
})

// POST /auth/register
router.post('/register', validate(registerSchema), async (req, res) => {
  const { phone, name, email, password, otp, country_code, account_type } = req.body

  // Verify OTP
  const otpResult = await query(
    `SELECT id FROM phone_otps
     WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, otp]
  )
  if (!otpResult.rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' })
  await query(`UPDATE phone_otps SET used = TRUE WHERE id = $1`, [otpResult.rows[0].id])

  const existing = await query('SELECT id FROM users WHERE phone = $1', [phone])
  if (existing.rows.length) return res.status(409).json({ error: 'Phone already registered' })

  const passwordHash = password ? await bcrypt.hash(password, 12) : null
  const result = await query(
    `INSERT INTO users (phone, name, email, password_hash, country_code, account_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, phone, email, country_code, account_type, created_at`,
    [phone, name, email || null, passwordHash, country_code, account_type]
  )
  const user = result.rows[0]
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  res.status(201).json({ user, token })
})

// POST /auth/login
router.post('/login', validate(loginSchema), async (req, res) => {
  const { phone, password, otp } = req.body

  // Verify OTP first
  const otpResult = await query(
    `SELECT id FROM phone_otps
     WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, otp]
  )
  if (!otpResult.rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' })

  const result = await query(
    `SELECT id, name, phone, email, avatar_url, push_token, country_code, account_type, password_hash
     FROM users WHERE phone = $1`,
    [phone]
  )
  if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' })
  const user = result.rows[0]

  const valid = await bcrypt.compare(password, user.password_hash || '')
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

  // Mark OTP used only after password also verified
  await query(`UPDATE phone_otps SET used = TRUE WHERE id = $1`, [otpResult.rows[0].id])

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  const { password_hash, ...safeUser } = user
  res.json({ user: safeUser, token })
})

// ── Google OAuth ──────────────────────────────────────────
function decodeGoogleToken(idToken) {
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch(e) { return null }
}

router.post('/google', async (req, res) => {
  const { id_token, account_type } = req.body
  if (!id_token) return res.status(400).json({ error: 'id_token required' })
  const payload = decodeGoogleToken(id_token)
  if (!payload || !payload.email) return res.status(400).json({ error: 'Invalid Google token' })
  const { email, name, sub: googleId } = payload
  const type = (account_type === 'child') ? 'child' : 'parent'

  let result = await query(
    `SELECT id, name, phone, email, avatar_url, push_token, country_code, account_type
     FROM users WHERE google_id = $1 OR email = $2`,
    [googleId, email]
  )
  let user
  if (result.rows.length) {
    user = result.rows[0]
    if (!user.google_id) {
      await query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]).catch(() => {})
    }
  } else {
    const inserted = await query(
      `INSERT INTO users (name, email, google_id, country_code, account_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, phone, email, avatar_url, push_token, country_code, account_type`,
      [name || email.split('@')[0], email, googleId, 'IN', type]
    ).catch(async () => {
      return query(
        `INSERT INTO users (name, email, country_code, account_type)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, phone, email, avatar_url, push_token, country_code, account_type`,
        [name || email.split('@')[0], email, 'IN', type]
      )
    })
    user = inserted.rows[0]
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  res.json({ user, token })
})

module.exports = router
