const router = require('express').Router()
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const { query } = require('../config/db')
const crypto = require('crypto')
const { GLOBAL_API_WINDOW_MS, GLOBAL_API_MAX } = require('../config/rateLimits')

// Falls back to JWT_SECRET if ADMIN_JWT_SECRET isn't configured yet, so
// existing deployments don't break — but a shared secret means one leaked
// user-auth secret compromises admin too. Set ADMIN_JWT_SECRET in .env to
// fully separate the two trust roots.
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET
if (!process.env.ADMIN_JWT_SECRET) {
  console.warn('[admin] ADMIN_JWT_SECRET not set — falling back to JWT_SECRET (shared with regular user auth)')
}

// Admin auth middleware
const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token']
  if (!token) return res.status(401).json({ error: 'Admin token required' })
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET)
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Not admin' })
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid admin token' })
  }
}

// The global /api/ limiter (12000 req/15min) is sized for location-polling
// families and is far too permissive for a password-guessing endpoint —
// this caps login attempts specifically, independent of that budget.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
})

// POST /api/v1/admin/login
router.post('/login', adminLoginLimiter, async (req, res) => {
  const { password } = req.body
  if (!password || password !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Invalid admin password' })
  }
  const token = jwt.sign({ role: 'admin' }, ADMIN_JWT_SECRET, { expiresIn: '12h' })
  res.json({ token, admin: true })
})

// GET /api/v1/admin/dashboard
router.get('/dashboard', adminAuth, async (req, res) => {
  // Ensure is_banned column exists
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE').catch(() => {})

  const [users, circles, active, sosToday, geoEvents, locCount] = await Promise.all([
    query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE account_type='parent') parents, COUNT(*) FILTER (WHERE account_type='child') children, COUNT(*) FILTER (WHERE is_banned=TRUE) banned FROM users"),
    query('SELECT COUNT(*) total FROM circles'),
    query("SELECT COUNT(DISTINCT user_id) total FROM user_latest_locations WHERE updated_at > NOW() - INTERVAL '5 minutes'"),
    query("SELECT COUNT(*) total FROM sos_events WHERE created_at > NOW() - INTERVAL '24 hours'").catch(() => ({ rows: [{ total: 0 }] })),
    query('SELECT COUNT(*) total FROM geofence_events'),
    query('SELECT COUNT(*) total FROM device_locations'),
  ])
  res.json({
    stats: {
      totalUsers: parseInt(users.rows[0].total),
      parents: parseInt(users.rows[0].parents),
      children: parseInt(users.rows[0].children),
      banned: parseInt(users.rows[0].banned),
      totalCircles: parseInt(circles.rows[0].total),
      activeUsers: parseInt(active.rows[0].total),
      sosToday: parseInt(sosToday.rows[0].total),
      geofenceEvents: parseInt(geoEvents.rows[0].total),
      locationPoints: parseInt(locCount.rows[0].total),
    }
  })
})

// GET /api/v1/admin/users?page=1&search=&limit=20
router.get('/users', adminAuth, async (req, res) => {
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE').catch(() => {})
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const limit = parseInt(req.query.limit) || 20
  const search = (req.query.search || '').trim()
  const role = (req.query.role || 'all').trim()
  const status = (req.query.status || 'all').trim()
  const offset = (page - 1) * limit

  const conditions = []
  const params = []
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`)
  }
  if (role === 'parent' || role === 'child') {
    params.push(role)
    conditions.push(`account_type = $${params.length}`)
  }
  if (status === 'active') {
    conditions.push('COALESCE(is_banned, FALSE) = FALSE')
  } else if (status === 'banned') {
    conditions.push('is_banned = TRUE')
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const listParams = [...params, limit, offset]
  const limitIdx = params.length + 1
  const offsetIdx = params.length + 2

  const [countRes, usersRes] = await Promise.all([
    query(`SELECT COUNT(*) total FROM users ${where}`, params),
    query(`SELECT id, name, phone, email, account_type, country_code, avatar_url, created_at, is_banned,
      (SELECT COUNT(*) FROM circle_members WHERE user_id = users.id) circle_count
      FROM users ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`, listParams)
  ])
  res.json({ users: usersRes.rows, total: parseInt(countRes.rows[0].total), page, limit })
})

// PATCH /api/v1/admin/users/:id/ban
router.patch('/users/:id/ban', adminAuth, async (req, res) => {
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE').catch(() => {})
  const r = await query('UPDATE users SET is_banned = NOT COALESCE(is_banned, FALSE) WHERE id = $1 RETURNING id, name, is_banned', [req.params.id])
  if (!r.rows.length) return res.status(404).json({ error: 'User not found' })
  res.json({ user: r.rows[0] })
})

// DELETE /api/v1/admin/users/:id
router.delete('/users/:id', adminAuth, async (req, res) => {
  const r = await query('DELETE FROM users WHERE id = $1 RETURNING id, name', [req.params.id])
  if (!r.rows.length) return res.status(404).json({ error: 'User not found' })
  res.json({ deleted: r.rows[0] })
})

// GET /api/v1/admin/circles
router.get('/circles', adminAuth, async (req, res) => {
  const r = await query(`
    SELECT c.id, c.name, c.invite_code, c.created_at,
      u.name owner_name, u.phone owner_phone,
      (SELECT COUNT(*) FROM circle_members WHERE circle_id = c.id) member_count,
      (SELECT COUNT(*) FROM safe_zones WHERE circle_id = c.id) zone_count
    FROM circles c
    LEFT JOIN users u ON u.id = c.created_by
    ORDER BY c.created_at DESC
  `)
  res.json({ circles: r.rows })
})

// POST /api/v1/admin/circles — create circle
router.post("/circles", adminAuth, async (req, res) => {
  const { name, ownerPhone } = req.body
  if (!name || !ownerPhone) return res.status(400).json({ error: "name and ownerPhone required" })
  const owner = await query("SELECT id FROM users WHERE phone = $1", [ownerPhone])
  if (!owner.rows.length) return res.status(404).json({ error: "Owner not found with that phone" })
  const code = crypto.randomBytes(6).toString("hex").toUpperCase()
  const r = await query("INSERT INTO circles (name, created_by, invite_code) VALUES ($1,$2,$3) RETURNING id,name,invite_code,created_at", [name, owner.rows[0].id, code])
  await query("INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [r.rows[0].id, owner.rows[0].id, "admin"])
  res.status(201).json({ circle: r.rows[0] })
})

// DELETE /api/v1/admin/circles/:id
router.delete('/circles/:id', adminAuth, async (req, res) => {
  const r = await query('DELETE FROM circles WHERE id = $1 RETURNING id, name', [req.params.id])
  if (!r.rows.length) return res.status(404).json({ error: 'Circle not found' })
  res.json({ deleted: r.rows[0] })
})

// PATCH /api/v1/admin/circles/:id/invite
router.patch('/circles/:id/invite', adminAuth, async (req, res) => {
  const newCode = crypto.randomBytes(6).toString('hex').toUpperCase()
  const r = await query('UPDATE circles SET invite_code = $1 WHERE id = $2 RETURNING id, name, invite_code', [newCode, req.params.id])
  if (!r.rows.length) return res.status(404).json({ error: 'Circle not found' })
  res.json({ circle: r.rows[0] })
})

// GET /api/v1/admin/sos
router.get('/sos', adminAuth, async (req, res) => {
  const r = await query('SELECT se.*, u.phone user_phone FROM sos_events se LEFT JOIN users u ON u.id = se.user_id ORDER BY se.created_at DESC LIMIT 100')
  res.json({ sos_events: r.rows })
})

// PATCH /api/v1/admin/sos/:id/resolve
router.patch('/sos/:id/resolve', adminAuth, async (req, res) => {
  const r = await query('UPDATE sos_events SET resolved = TRUE WHERE id = $1 RETURNING id', [req.params.id])
  if (!r.rows.length) return res.status(404).json({ error: 'Not found' })
  res.json({ resolved: true })
})

// GET /api/v1/admin/geofences
router.get('/geofences', adminAuth, async (req, res) => {
  const r = await query(`
    SELECT ge.id, ge.event_type, ge.created_at,
      u.name user_name, u.phone,
      sz.name zone_name, c.name circle_name
    FROM geofence_events ge
    LEFT JOIN users u ON u.id = ge.user_id
    LEFT JOIN safe_zones sz ON sz.id = ge.safe_zone_id
    LEFT JOIN circles c ON c.id = sz.circle_id
    ORDER BY ge.created_at DESC LIMIT 200
  `)
  res.json({ events: r.rows })
})

// GET /api/v1/admin/otps
// Codes that are still unused AND unexpired are still valid, live login
// credentials — anyone with admin access could use one to log into that
// user's account before they enter it themselves. Mask those; a used or
// expired code can no longer log anyone in, so it's safe to show for
// SMS-delivery debugging.
router.get('/otps', adminAuth, async (req, res) => {
  const r = await query('SELECT phone, code, expires_at, used, sms_sent, created_at FROM phone_otps ORDER BY created_at DESC LIMIT 100')
  const now = Date.now()
  const otps = r.rows.map((row) => {
    const isLive = !row.used && new Date(row.expires_at).getTime() > now
    return { ...row, code: isLive ? '••••••' : row.code }
  })
  res.json({ otps })
})

// GET /api/v1/admin/system
router.get('/system', adminAuth, async (req, res) => {
  const { getConnectedCount } = require('../services/sse')
  const connected = getConnectedCount()
  const [tables, dbSize] = await Promise.all([
    query(`SELECT relname AS name, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC`).catch(() => ({ rows: [] })),
    query(`SELECT pg_size_pretty(pg_database_size(current_database())) db_size`).catch(() => ({ rows: [{ db_size: 'N/A' }] })),
  ])
  res.json({
    dbSize: dbSize.rows[0]?.db_size || 'N/A',
    tables: tables.rows,
    rateLimit: { windowMs: GLOBAL_API_WINDOW_MS, max: GLOBAL_API_MAX },
    nodeVersion: process.version,
    uptime: process.uptime(),
    connectedClients: connected,
  })
})

// DELETE /api/v1/admin/locations/purge
router.delete('/locations/purge', adminAuth, async (req, res) => {
  const days = Math.max(1, parseInt(req.query.days) || 30)
  const r = await query(`DELETE FROM device_locations WHERE recorded_at < NOW() - INTERVAL '${days} days'`)
  res.json({ deleted: r.rowCount, days })
})

// POST /api/v1/admin/broadcast
router.post('/broadcast', adminAuth, async (req, res) => {
  const { message, type = 'info' } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })
  const { sendToAllConnected, getConnectedCount } = require('../services/sse')
  const count = getConnectedCount()
  sendToAllConnected('admin_broadcast', { message, type, timestamp: new Date().toISOString() })
  res.json({ sent: true, message, type, recipients: count })
})

module.exports = router
