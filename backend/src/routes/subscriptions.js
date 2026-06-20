const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')

// GET /api/v1/subscriptions/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const r = await query(`
      SELECT us.*, sp.display_name, sp.max_members, sp.max_circles, sp.history_days, sp.features
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE us.user_id=$1 AND us.status='active'
      ORDER BY us.created_at DESC LIMIT 1`, [req.user.id])
    if (!r.rows.length) return res.json({ plan_id:'free', status:'active', display_name:'Free Forever', max_members:4, max_circles:1, history_days:1, features:['Live location sharing','1 Safe Zone','SOS Panic Button'] })
    const row = r.rows[0]
    if (row.features && typeof row.features === 'string') row.features = JSON.parse(row.features)
    res.json(row)
  } catch(e) {
    console.error('subscriptions/me:', e)
    res.json({ plan_id:'free', status:'active', display_name:'Free Forever', max_members:4, max_circles:1, history_days:1 })
  }
})

// POST /api/v1/subscriptions/cancel
router.post('/cancel', authenticate, async (req, res) => {
  try {
    await query("UPDATE user_subscriptions SET status='cancelled', cancelled_at=NOW(), updated_at=NOW() WHERE user_id=$1 AND status='active'", [req.user.id])
    await query("UPDATE users SET current_plan='free' WHERE id=$1", [req.user.id])
    res.json({ success: true, message: 'Subscription cancelled. Access continues until end of billing period.' })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// GET /api/v1/subscriptions/history
router.get('/history', authenticate, async (req, res) => {
  try {
    const r = await query(`
      SELECT po.id, po.gateway, po.amount, po.currency, po.status, po.created_at, sp.display_name as plan_name
      FROM payment_orders po
      LEFT JOIN subscription_plans sp ON sp.id=po.plan_id
      WHERE po.user_id=$1 ORDER BY po.created_at DESC LIMIT 20`, [req.user.id])
    res.json({ payments: r.rows })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
