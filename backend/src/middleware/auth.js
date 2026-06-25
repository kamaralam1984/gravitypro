const jwt = require('jsonwebtoken')
const { query } = require('../config/db')

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' })
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const result = await query('SELECT id, name, phone, email, avatar_url, push_token, country_code, account_type, current_plan, share_location, notif_arrivals, notif_sos, notif_geofence, speed_alert_kmh FROM users WHERE id = $1', [decoded.userId])
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' })
    req.user = result.rows[0]
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = { authenticate }
