const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const { query } = require('../config/db')
const crypto = require('crypto')

// The global /api/ limiter (12000 req/15min, app.js) is sized for
// location-polling families and far too permissive for endpoints that check
// a 6-digit OTP or a password — same reasoning as admin.js's
// adminLoginLimiter, applied here to every user-facing endpoint that
// verifies an OTP/password against a stored value.
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
})

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
    // Force IPv4 — this VPS resolves smtp.gmail.com to an IPv6 address by
    // default, and its IPv6 route corrupts the TLS handshake ("wrong version
    // number" from openssl, even though the plain TCP connect succeeds).
    // IPv4 avoids that route entirely.
    family: 4,
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
    // Return OTP when no email was sent so testers can use without real SMTP —
    // NEVER in production, same reasoning as send-otp above.
    ...(!emailSent && process.env.NODE_ENV !== 'production' && { dev_otp: otp }),
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
router.post('/verify-email', otpVerifyLimiter, async (req, res) => {
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
router.post('/verify-email-otp', otpVerifyLimiter, async (req, res) => {
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

// ── Google OAuth ──────────────────────────────────────────
// Disabled: the previous implementation decoded the id_token's payload
// without verifying its cryptographic signature, audience, or issuer —
// anyone could POST a self-forged token claiming any email and receive a
// valid session for that account. No client (mobile or web) actually wires
// up real Google Sign-In yet (see mobile/src/screens/auth/LoginScreen.jsx —
// handleGoogleSignIn is still a TODO stub) and no GOOGLE_CLIENT_ID is
// configured anywhere, so this is disabled until it can be rebuilt on
// google-auth-library's verifyIdToken() with a real audience check.
router.post('/google', async (req, res) => {
  res.status(501).json({ error: 'Google sign-in is not available yet' })
})

// POST /auth/register-free
// Creates a free account using a verified email_token. Login/registration is
// email-only; phone is an optional plain contact-info field (not a
// credential — no verification needed for it, same as name).
router.post('/register-free', async (req, res) => {
  try {
    const { email_token, name, account_type, country_code, phone: rawPhone } = req.body

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

    const phone = rawPhone && String(rawPhone).trim() ? String(rawPhone).trim() : null
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
