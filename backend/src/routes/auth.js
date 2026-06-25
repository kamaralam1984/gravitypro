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

// Resolve with the promise's result if it settles within `ms`, otherwise resolve
// `false` and let the original promise finish in the background (its rejection is
// swallowed). Keeps the OTP endpoint fast so the mobile client never times out.
function sendWithin(promise, ms) {
  const safe = Promise.resolve(promise).catch(() => false)
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), ms))
  return Promise.race([safe, timeout])
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

// ── Email OTP delivery — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM to enable ──
let _mailer = null
function getMailer() {
  if (_mailer) return _mailer
  if (!process.env.SMTP_HOST) return null
  const nodemailer = require('nodemailer')
  _mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true' || parseInt(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  return _mailer
}

async function sendEmailOTP(email, otp) {
  const mailer = getMailer()
  if (mailer) {
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || 'Gravity <no-reply@gravitypro.kvlbusinesssolutions.com>',
        to: email,
        subject: `${otp} is your Gravity verification code`,
        text: `Your Gravity verification code is ${otp}. It expires in 10 minutes.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;background:#050F08;color:#fff;border-radius:12px">
          <h2 style="margin:0 0 8px">Gravity</h2>
          <p style="color:#9fb3a8;margin:0 0 16px">Your verification code</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#00E676">${otp}</div>
          <p style="color:#6b7d73;font-size:13px;margin-top:16px">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>`,
      })
      return true
    } catch (e) {
      console.error('Email OTP send failed:', e.message)
    }
  }
  // Dev fallback — log OTP to console
  console.log(`[EMAIL OTP] ${email} → ${otp}`)
  return false
}

// POST /auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body
  if (!phone || phone.trim().length < 7) {
    return res.status(400).json({ error: 'Valid phone number required' })
  }
  const cleanPhone = phone.trim()

  // Rate limit: max 10 OTPs per phone in 5 minutes
  const recent = await query(
    `SELECT COUNT(*) FROM phone_otps WHERE phone = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
    [cleanPhone]
  )
  if (parseInt(recent.rows[0].count) >= 10) {
    return res.status(429).json({ error: 'Too many OTP requests. Wait 5 minutes.' })
  }

  // Invalidate old OTPs
  await query(`UPDATE phone_otps SET used = TRUE WHERE phone = $1 AND used = FALSE`, [cleanPhone])

  const otp = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min
  await query(
    `INSERT INTO phone_otps (phone, code, expires_at) VALUES ($1, $2, $3)`,
    [cleanPhone, otp, expiresAt]
  )

  // Don't block the HTTP response on the (possibly slow) SMS provider — that caused
  // the app to time out and show "Network Error". Wait at most 4s, then respond.
  const smsSent = await sendWithin(sendSMS(cleanPhone, otp), 4000)

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

// ── Email OTP endpoints ───────────────────────────────────
// POST /auth/send-email-otp
router.post('/send-email-otp', async (req, res) => {
  const cleanEmail = (req.body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  // Rate limit: max 10 OTPs per email in 5 minutes
  const recent = await query(
    `SELECT COUNT(*) FROM email_otps WHERE email = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
    [cleanEmail]
  )
  if (parseInt(recent.rows[0].count) >= 10) {
    return res.status(429).json({ error: 'Too many OTP requests. Wait 5 minutes.' })
  }

  // Invalidate old OTPs
  await query(`UPDATE email_otps SET used = TRUE WHERE email = $1 AND used = FALSE`, [cleanEmail])

  const otp = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min
  await query(
    `INSERT INTO email_otps (email, code, expires_at) VALUES ($1, $2, $3)`,
    [cleanEmail, otp, expiresAt]
  )

  // Don't block the HTTP response on the (possibly slow) SMTP send — that caused
  // the app to time out and show "Network Error". Wait at most 4s, then respond.
  const emailSent = await sendWithin(sendEmailOTP(cleanEmail, otp), 4000)
  res.json({
    success: true,
    email_sent: emailSent,
    // Return OTP when no email was sent so testers can use without real SMTP
    ...(!emailSent && { dev_otp: otp }),
  })
})

// Validate an email OTP and mark it used. Returns true/false.
async function consumeEmailOTP(email, otp) {
  const result = await query(
    `SELECT id FROM email_otps
     WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, otp]
  )
  if (!result.rows.length) return false
  await query(`UPDATE email_otps SET used = TRUE WHERE id = $1`, [result.rows[0].id])
  return true
}

// POST /auth/verify-email — verify email OTP at SIGNUP; returns short-lived email_token.
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp) return res.status(400).json({ error: 'email and otp required' })
    const cleanEmail = email.trim().toLowerCase()

    const ok = await consumeEmailOTP(cleanEmail, otp.trim())
    if (!ok) return res.status(400).json({ error: 'Invalid or expired OTP' })

    const email_token = jwt.sign(
      { email: cleanEmail, type: 'email_verified' },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    )
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail])
    res.json({ verified: true, email_token, already_registered: existing.rows.length > 0 })
  } catch (err) {
    console.error('verify-email error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /auth/verify-email-otp — LOGIN via email OTP. Returns { user, token }.
router.post('/verify-email-otp', async (req, res) => {
  const { email, otp } = req.body
  if (!email || !otp) return res.status(400).json({ error: 'email and otp required' })
  const cleanEmail = email.trim().toLowerCase()

  const ok = await consumeEmailOTP(cleanEmail, otp.trim())
  if (!ok) return res.status(400).json({ error: 'Invalid or expired OTP' })

  const userResult = await query(
    `SELECT id, name, phone, email, avatar_url, push_token, country_code, account_type
     FROM users WHERE LOWER(email) = $1`,
    [cleanEmail]
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

  // password_hash is NOT NULL in the schema. When no password is provided
  // (OTP-only signup), store a random unguessable hash so the row is valid and
  // password login is effectively disabled until the user sets a password.
  const passwordHash = password
    ? await bcrypt.hash(password, 12)
    : await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
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
    // Google users have no password — store a random hash (password_hash is
    // NOT NULL in older schemas; see migration 009).
    const googleHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
    const inserted = await query(
      `INSERT INTO users (name, email, google_id, country_code, account_type, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, phone, email, avatar_url, push_token, country_code, account_type`,
      [name || email.split('@')[0], email, googleId, 'IN', type, googleHash]
    ).catch(async () => {
      return query(
        `INSERT INTO users (name, email, country_code, account_type, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, phone, email, avatar_url, push_token, country_code, account_type`,
        [name || email.split('@')[0], email, 'IN', type, googleHash]
      )
    })
    user = inserted.rows[0]
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
  res.json({ user, token })
})

// POST /auth/verify-phone
// Verifies OTP, marks it used, returns a short-lived phone_token JWT.
// Does NOT create any user account.
router.post('/verify-phone', async (req, res) => {
  try {
    const { phone, otp } = req.body
    if (!phone || !otp) return res.status(400).json({ error: 'phone and otp required' })

    const cleanPhone = phone.trim()
    const cleanOtp = otp.trim()

    const result = await query(
      `SELECT id FROM phone_otps
       WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanPhone, cleanOtp]
    )
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' })

    // Mark OTP used
    await query(`UPDATE phone_otps SET used = TRUE WHERE id = $1`, [result.rows[0].id])

    const phone_token = jwt.sign(
      { phone: cleanPhone, type: 'phone_verified' },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    )

    // Check if phone already has an account
    const existing = await query('SELECT id FROM users WHERE phone = $1', [cleanPhone])
    if (existing.rows.length) {
      return res.json({ verified: true, phone_token, already_registered: true })
    }

    res.json({ verified: true, phone_token })
  } catch (err) {
    console.error('verify-phone error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /auth/register-free
// Creates a free account using a verified phone_token.
router.post('/register-free', async (req, res) => {
  try {
    const { phone_token, email_token, name, account_type, country_code } = req.body

    // Email is the PRIMARY required verification. Phone is OPTIONAL — pass a
    // phone_token only if the user chose to verify a phone number (SMS).
    if (!email_token) return res.status(400).json({ error: 'email_token required' })

    // Verify email_token (required)
    let emailPayload
    try {
      emailPayload = jwt.verify(email_token, process.env.JWT_SECRET)
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired email_token' })
    }
    if (emailPayload.type !== 'email_verified') {
      return res.status(401).json({ error: 'Invalid email token type' })
    }

    // Verify phone_token (optional — only if provided)
    let phone = null
    if (phone_token) {
      let phonePayload
      try {
        phonePayload = jwt.verify(phone_token, process.env.JWT_SECRET)
      } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired phone_token' })
      }
      if (phonePayload.type !== 'phone_verified') {
        return res.status(401).json({ error: 'Invalid phone token type' })
      }
      phone = phonePayload.phone
    }

    const email = emailPayload.email

    // Validate name
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'name must be at least 2 characters' })
    }

    // Validate account_type
    if (!['parent', 'child'].includes(account_type)) {
      return res.status(400).json({ error: "account_type must be 'parent' or 'child'" })
    }

    // Validate country_code
    const validCountryCodes = ['KE', 'IN', 'AE', 'GB', 'US', 'PK', 'UG', 'TZ', 'NG', 'ZA', 'CA', 'AU']
    const resolvedCountryCode = country_code || 'IN'
    if (!validCountryCodes.includes(resolvedCountryCode)) {
      return res.status(400).json({ error: 'Invalid country_code' })
    }

    // Check email (and phone, if provided) not already registered
    const existing = await query(
      'SELECT phone, email FROM users WHERE LOWER(email) = $1 OR ($2::text IS NOT NULL AND phone = $2)',
      [email, phone]
    )
    if (existing.rows.length) {
      const clash = phone && existing.rows.find(r => r.phone === phone)
      return res.status(409).json({ error: clash ? 'Phone already registered' : 'Email already registered' })
    }

    // Generate a random password hash (user has no password — OTP-only auth)
    const randomHash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10)

    // Create user with free plan (email OTP-verified; phone optional/nullable)
    const insertResult = await query(
      `INSERT INTO users (phone, name, email, country_code, account_type, current_plan, password_hash)
       VALUES ($1, $2, $3, $4, $5, 'free', $6)
       RETURNING id, name, phone, email, country_code, account_type, current_plan, created_at`,
      [phone, name.trim(), email, resolvedCountryCode, account_type, randomHash]
    )
    const user = insertResult.rows[0]
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN })
    res.status(201).json({ user, token })
  } catch (err) {
    console.error('register-free error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
