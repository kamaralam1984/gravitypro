const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { sendToCircleMembers } = require('../services/sse')

// POST /api/v1/sos — trigger SOS alert
router.post('/', authenticate, async (req, res) => {
  const { latitude, longitude, message } = req.body
  const userId = req.user.id
  // Get all circles this user belongs to
  const circles = await query('SELECT circle_id FROM circle_members WHERE user_id = $1', [userId])
  if (!circles.rows.length) return res.status(400).json({ error: 'Not in any circle' })
  const sosData = {
    userId,
    userName: req.user.name,
    userAvatar: req.user.avatar_url,
    latitude: latitude || null,
    longitude: longitude || null,
    message: message || 'SOS! I need help!',
    timestamp: new Date().toISOString(),
  }
  // Send SOS via SSE to all circle members
  for (const row of circles.rows) {
    await sendToCircleMembers(row.circle_id, 'sos_alert', sosData)
  }
  // Send push notifications to all circle members
  try {
    const tokens = await query(
      "SELECT DISTINCT u.push_token FROM circle_members cm JOIN users u ON u.id = cm.user_id WHERE cm.circle_id = ANY($1) AND u.push_token IS NOT NULL AND u.id != $2",
      [circles.rows.map(r => r.circle_id), userId]
    )
    if (tokens.rows.length) {
      const messages = tokens.rows.map(t => ({
        to: t.push_token,
        title: "🆘 SOS Alert",
        body: (sosData.userName || "Family member") + " needs help! " + sosData.message,
        data: { type: "sos", latitude: sosData.latitude, longitude: sosData.longitude },
        sound: "default",
        priority: "high",
      }))
      const chunks = []
      for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i+100))
      for (const chunk of chunks) {
        fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(chunk)
        }).catch(() => {})
      }
    }
  } catch {}
  // ── Also notify the raiser's emergency contacts ──────────────────────────────
  // Emergency contacts are free-form (name/phone/relation) and have no push
  // tokens of their own. We (a) log each one, and (b) if a contact's phone
  // matches a registered user who has a push token, send them a push too.
  // (No SMS gateway util exists in this codebase yet — see integration notes.)
  try {
    const contacts = await query(
      'SELECT name, phone, relation FROM emergency_contacts WHERE owner_user_id = $1',
      [userId]
    )
    if (contacts.rows.length) {
      console.log(
        `[SOS] Notifying ${contacts.rows.length} emergency contact(s) for user ${userId}:`,
        contacts.rows.map(c => `${c.name}${c.phone ? ' <' + c.phone + '>' : ''}`).join(', ')
      )
      const phones = contacts.rows.map(c => c.phone).filter(Boolean)
      if (phones.length) {
        const ecTokens = await query(
          "SELECT DISTINCT push_token FROM users WHERE phone = ANY($1) AND push_token IS NOT NULL AND id != $2",
          [phones, userId]
        )
        if (ecTokens.rows.length) {
          const ecMessages = ecTokens.rows.map(t => ({
            to: t.push_token,
            title: "🆘 Emergency Contact SOS",
            body: (sosData.userName || "Someone") + " listed you as an emergency contact and needs help! " + sosData.message,
            data: { type: "sos", latitude: sosData.latitude, longitude: sosData.longitude },
            sound: "default",
            priority: "high",
          }))
          fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(ecMessages)
          }).catch(() => {})
        }
      }
    }
  } catch (e) {
    console.error('[SOS] emergency-contact notify failed:', e.message)
  }
  // Log SOS to DB
  for (const row of circles.rows) {
    await query(
      `INSERT INTO sos_events (user_id, user_name, circle_id, latitude, longitude, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [userId, req.user.name, row.circle_id, latitude || null, longitude || null, message || 'SOS! I need help!']
    ).catch(() => {})
  }
  // Log SOS event in geofence_events table if location available
  if (latitude && longitude) {
    await query(
      `INSERT INTO device_locations (user_id, geom, recorded_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), NOW())`,
      [userId, longitude, latitude]
    ).catch(() => {}) // don't fail if table issue
  }
  res.json({ success: true, message: 'SOS sent to all circle members' })
})

// POST /api/v1/sos/safe — notify circle that user is safe
router.post('/safe', authenticate, async (req, res) => {
  const { message } = req.body
  const userId = req.user.id
  const circles = await query('SELECT circle_id FROM circle_members WHERE user_id = $1', [userId])
  if (!circles.rows.length) return res.status(400).json({ error: 'Not in any circle' })
  const safeData = {
    userId,
    userName: req.user.name,
    userAvatar: req.user.avatar_url,
    message: message || "I'm safe!",
    timestamp: new Date().toISOString(),
  }
  for (const row of circles.rows) {
    await sendToCircleMembers(row.circle_id, 'sos_safe', safeData)
  }
  try {
    const tokens = await query(
      "SELECT DISTINCT u.push_token FROM circle_members cm JOIN users u ON u.id = cm.user_id WHERE cm.circle_id = ANY($1) AND u.push_token IS NOT NULL AND u.id != $2",
      [circles.rows.map(r => r.circle_id), userId]
    )
    if (tokens.rows.length) {
      const messages = tokens.rows.map(t => ({
        to: t.push_token,
        title: "✅ Safe",
        body: (safeData.userName || "Family member") + " is safe. " + safeData.message,
        data: { type: "sos_safe" },
        sound: "default",
      }))
      fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(messages)
      }).catch(() => {})
    }
  } catch {}
  res.json({ success: true, message: 'Safe notification sent' })
})

// GET /api/v1/sos/history — get SOS history (optionally filtered by circle_id)
router.get('/history', authenticate, async (req, res) => {
  await query(`CREATE TABLE IF NOT EXISTS sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT, circle_id UUID, latitude FLOAT, longitude FLOAT,
    message TEXT, resolved BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {})
  const { circle_id } = req.query
  const r = circle_id
    ? await query(
        'SELECT se.*, u.phone FROM sos_events se LEFT JOIN users u ON u.id=se.user_id WHERE se.circle_id=$1 ORDER BY se.created_at DESC LIMIT 50',
        [circle_id]
      )
    : await query(
        'SELECT se.*, u.phone FROM sos_events se LEFT JOIN users u ON u.id=se.user_id ORDER BY se.created_at DESC LIMIT 50',
        []
      )
  res.json({ sos_events: r.rows })
})

// PATCH /api/v1/sos/:sosId/resolve — mark SOS as resolved
router.patch('/:sosId/resolve', authenticate, async (req, res) => {
  try {
    const r = await query(
      'UPDATE sos_events SET resolved = TRUE WHERE id = $1 RETURNING id',
      [req.params.sosId]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'SOS event not found' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to resolve SOS' })
  }
})

module.exports = router
