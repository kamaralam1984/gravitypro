const router = require('express').Router()
const jwt = require('jsonwebtoken')
const { query } = require('../config/db')
const crypto = require('crypto')

// Admin auth middleware
const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token']
  if (!token) return res.status(401).json({ error: 'Admin token required' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Not admin' })
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid admin token' })
  }
}

// POST /api/v1/admin/login
router.post('/login', async (req, res) => {
  const { password } = req.body
  if (!password || password !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Invalid admin password' })
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' })
  res.json({ token, admin: true })
})

// GET /api/v1/admin/dashboard
router.get('/dashboard', adminAuth, async (req, res) => {
  // Ensure sos_events table exists
  await query(`CREATE TABLE IF NOT EXISTS sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT,
    circle_id UUID,
    latitude FLOAT, longitude FLOAT, message TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {})
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
  const offset = (page - 1) * limit
  const where = search ? `WHERE (name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)` : ''
  const params = search ? [`%${search}%`] : []
  const countParams = [...params]
  const listParams = search ? [...params, limit, offset] : [limit, offset]
  const limitIdx = search ? 2 : 1
  const offsetIdx = search ? 3 : 2

  const [countRes, usersRes] = await Promise.all([
    query(`SELECT COUNT(*) total FROM users ${where}`, countParams),
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
  await query(`CREATE TABLE IF NOT EXISTS sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT, circle_id UUID, latitude FLOAT, longitude FLOAT,
    message TEXT, resolved BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {})
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
router.get('/otps', adminAuth, async (req, res) => {
  const r = await query('SELECT phone, code, expires_at, used, created_at FROM phone_otps ORDER BY created_at DESC LIMIT 100')
  res.json({ otps: r.rows })
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
    rateLimit: { windowMs: 900000, max: 1000 },
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

// GET /api/v1/admin/subscriptions
router.get('/subscriptions', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = 50, offset = (page - 1) * limit
    const r = await query(`SELECT us.*, u.phone, u.name as user_name, sp.display_name as plan_name
      FROM user_subscriptions us LEFT JOIN users u ON u.id=us.user_id
      LEFT JOIN subscription_plans sp ON sp.id=us.plan_id
      ORDER BY us.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset])
    const cnt = await query('SELECT COUNT(*) FROM user_subscriptions')
    res.json({ subscriptions: r.rows, total: parseInt(cnt.rows[0].count), page, limit })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/v1/admin/payments
router.get('/payments', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = 50, offset = (page - 1) * limit
    const r = await query(`SELECT po.*, u.phone, u.name as user_name, sp.display_name as plan_name
      FROM payment_orders po LEFT JOIN users u ON u.id=po.user_id
      LEFT JOIN subscription_plans sp ON sp.id=po.plan_id
      ORDER BY po.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset])
    const cnt = await query('SELECT COUNT(*) FROM payment_orders')
    res.json({ payments: r.rows, total: parseInt(cnt.rows[0].count), page, limit })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// PATCH /api/v1/admin/users/:id/plan — manually override user's subscription plan
router.patch('/users/:id/plan', adminAuth, async (req, res) => {
  try {
    const { plan, months = 1 } = req.body
    if (!['free','family','premium'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' })
    const now = new Date(), end = new Date(now)
    end.setMonth(end.getMonth() + months)
    await query("UPDATE user_subscriptions SET status='cancelled', cancelled_at=NOW() WHERE user_id=$1 AND status='active'", [req.params.id])
    if (plan !== 'free') {
      await query('INSERT INTO user_subscriptions (user_id,plan_id,status,gateway,current_period_start,current_period_end) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, plan, 'active', 'admin', now, end])
    }
    await query('UPDATE users SET current_plan=$1 WHERE id=$2', [plan, req.params.id])
    res.json({ success: true, plan, valid_until: end })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
