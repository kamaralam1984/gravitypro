const router = require('express').Router()
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')

// Returns true if userA and userB are members of at least one shared circle.
const sharesCircle = async (userA, userB) => {
  const result = await query(
    `SELECT 1
       FROM circle_members a
       JOIN circle_members b ON a.circle_id = b.circle_id
      WHERE a.user_id = $1 AND b.user_id = $2
      LIMIT 1`,
    [userA, userB]
  )
  return result.rows.length > 0
}

// ---------------- SCREEN TIME ----------------

// POST /app-usage  → child self-reports a batch of app usage for a day.
router.post('/app-usage', authenticate, async (req, res) => {
  const { date, apps } = req.body || {}
  if (!date || !Array.isArray(apps)) {
    return res.status(400).json({ error: 'date and apps[] are required' })
  }

  for (const app of apps) {
    if (!app || !app.package_name) continue
    await query(
      `INSERT INTO app_usage
         (user_id, package_name, app_label, usage_date, foreground_seconds, opens, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, package_name, usage_date)
       DO UPDATE SET
         app_label = EXCLUDED.app_label,
         foreground_seconds = EXCLUDED.foreground_seconds,
         opens = EXCLUDED.opens,
         updated_at = NOW()`,
      [
        req.user.id,
        app.package_name,
        app.app_label || null,
        date,
        Number.isFinite(app.foreground_seconds) ? app.foreground_seconds : 0,
        Number.isFinite(app.opens) ? app.opens : 0,
      ]
    )
  }

  res.json({ ok: true, count: apps.filter((a) => a && a.package_name).length })
})

// GET /app-usage/:userId?date=YYYY-MM-DD  → parent views a child's usage for a day.
router.get('/app-usage/:userId', authenticate, async (req, res) => {
  const { userId } = req.params
  const { date } = req.query
  if (!date) return res.status(400).json({ error: 'date query param is required' })

  if (req.user.id !== userId && !(await sharesCircle(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not authorized to view this user' })
  }

  const result = await query(
    `SELECT package_name, app_label, foreground_seconds, opens
       FROM app_usage
      WHERE user_id = $1 AND usage_date = $2
      ORDER BY foreground_seconds DESC`,
    [userId, date]
  )
  res.json(result.rows)
})

// ---------------- APP BLOCKING ----------------

// GET /blocked-apps  → the current user's own (active) block list.
router.get('/blocked-apps', authenticate, async (req, res) => {
  const result = await query(
    `SELECT package_name, app_label, blocked
       FROM blocked_apps
      WHERE child_user_id = $1 AND blocked = TRUE
      ORDER BY app_label NULLS LAST, package_name`,
    [req.user.id]
  )
  res.json({ apps: result.rows })
})

// GET /blocked-apps/:childId  → parent views a child's full block list (all rows).
router.get('/blocked-apps/:childId', authenticate, async (req, res) => {
  const { childId } = req.params

  if (req.user.id !== childId && !(await sharesCircle(req.user.id, childId))) {
    return res.status(403).json({ error: 'Not authorized to view this user' })
  }

  const result = await query(
    `SELECT package_name, app_label, blocked
       FROM blocked_apps
      WHERE child_user_id = $1
      ORDER BY app_label NULLS LAST, package_name`,
    [childId]
  )
  res.json({ apps: result.rows })
})

// PUT /blocked-apps/:childId  → parent sets/updates a child's block list.
router.put('/blocked-apps/:childId', authenticate, async (req, res) => {
  const { childId } = req.params
  const { apps } = req.body || {}
  if (!Array.isArray(apps)) {
    return res.status(400).json({ error: 'apps[] is required' })
  }

  if (!(await sharesCircle(req.user.id, childId))) {
    return res.status(403).json({ error: 'Not authorized to manage this user' })
  }

  const me = await query('SELECT account_type FROM users WHERE id = $1', [req.user.id])
  if (!me.rows.length || me.rows[0].account_type !== 'parent') {
    return res.status(403).json({ error: 'Only parent accounts can manage blocked apps' })
  }

  for (const app of apps) {
    if (!app || !app.package_name) continue
    await query(
      `INSERT INTO blocked_apps
         (child_user_id, package_name, app_label, blocked, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (child_user_id, package_name)
       DO UPDATE SET
         app_label = EXCLUDED.app_label,
         blocked = EXCLUDED.blocked,
         created_by = EXCLUDED.created_by,
         updated_at = NOW()`,
      [
        childId,
        app.package_name,
        app.app_label || null,
        app.blocked !== false,
        req.user.id,
      ]
    )
  }

  res.json({ ok: true, count: apps.filter((a) => a && a.package_name).length })
})

module.exports = router
