const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')

const createCircleSchema = z.object({
  name: z.string().min(2).max(100),
})

const generateInviteCode = () => crypto.randomBytes(6).toString('hex').toUpperCase()

router.get('/', authenticate, async (req, res) => {
  const result = await query(
    `SELECT c.id, c.name, c.icon_url, c.invite_code, c.created_by, c.created_at,
      cm.role,
      (SELECT COUNT(*) FROM circle_members WHERE circle_id = c.id) as member_count
     FROM circles c
     JOIN circle_members cm ON cm.circle_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [req.user.id]
  )
  res.json({ circles: result.rows })
})

router.post('/', authenticate, validate(createCircleSchema), async (req, res) => {
  const { name } = req.body
  const client = await (require('../config/db').getClient)()
  try {
    await client.query('BEGIN')
    const circle = await client.query(
      'INSERT INTO circles (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, generateInviteCode(), req.user.id]
    )
    await client.query(
      'INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, $3)',
      [circle.rows[0].id, req.user.id, 'admin']
    )
    await client.query('COMMIT')
    res.status(201).json({ circle: circle.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.post('/join', authenticate, async (req, res) => {
  const { invite_code } = req.body
  if (!invite_code) return res.status(400).json({ error: 'invite_code required' })
  const circleResult = await query('SELECT * FROM circles WHERE invite_code = $1', [invite_code])
  if (!circleResult.rows.length) return res.status(404).json({ error: 'Invalid invite code' })
  const circle = circleResult.rows[0]
  const existing = await query('SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circle.id, req.user.id])
  if (existing.rows.length) return res.status(409).json({ error: 'Already a member' })
  await query('INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, $3)', [circle.id, req.user.id, 'member'])

  // Registration leaves account_type at its 'parent' default unless the user
  // explicitly picks "Child" (see mobile RegisterScreen) — easy to miss, and
  // joining a circle by invite code never used to correct it, so a child who
  // just registered-and-joined could be permanently mislabeled "Parent" in
  // their own profile. A user joining someone else's circle as a plain member,
  // who has never created/administered a circle of their own, is — in this
  // app's real usage — a child joining their family via a parent's invite
  // code. Auto-correct here rather than leave that stuck wrong.
  if (req.user.account_type !== 'child') {
    // "Ever admin anywhere" isn't enough on its own: tapping "Create Circle"
    // by mistake before joining the real family circle makes someone admin of
    // a throwaway, empty circle, which would then permanently block this
    // auto-correction. Only an admin of a circle with at least one OTHER
    // member — i.e. one they've actually invited someone into — counts as
    // running a real family circle; being admin of a solo/empty circle does not.
    const realAdmin = await query(
      `SELECT 1 FROM circle_members cm1
        WHERE cm1.user_id = $1 AND cm1.role = 'admin'
          AND EXISTS (
            SELECT 1 FROM circle_members cm2
             WHERE cm2.circle_id = cm1.circle_id AND cm2.user_id != $1
          )
        LIMIT 1`,
      [req.user.id]
    )
    if (!realAdmin.rows.length) {
      await query("UPDATE users SET account_type = 'child' WHERE id = $1", [req.user.id])
    }
  }

  res.json({ circle, message: 'Joined successfully' })
})

router.get('/:circleId/members', authenticate, async (req, res) => {
  const membership = await query('SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, req.user.id])
  if (!membership.rows.length) return res.status(403).json({ error: 'Not a circle member' })
  const result = await query(
    `SELECT u.id, u.name, u.phone, u.avatar_url, u.account_type, cm.role, cm.joined_at,
      ull.updated_at as location_updated_at,
      ST_X(ull.geom) as longitude, ST_Y(ull.geom) as latitude,
      ull.battery_level, ull.speed, ull.bearing,
      zone.name as safe_zone_name,
      gc.resolved_name as geocoded_name, gc.resolved_type as geocoded_type
     FROM circle_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN user_latest_locations ull ON ull.user_id = u.id
     -- Live Map "current place name" (Travel Timeline) — safe zone always wins
     -- (never overridden by a road/area name); LIMIT 1 via LATERAL guards
     -- against row fan-out if zones ever overlap. Cache-only geocode lookup
     -- (no live API call here) keeps this hot polling path free of any
     -- reverse-geocoding cost — see services/geocoding.js.
     LEFT JOIN LATERAL (
       SELECT sz.name FROM safe_zones sz
       WHERE sz.circle_id = cm.circle_id AND ull.geom IS NOT NULL AND ST_Contains(sz.geom, ull.geom)
       LIMIT 1
     ) zone ON true
     LEFT JOIN geocode_cache gc ON ull.geom IS NOT NULL AND gc.geohash7 = ST_GeoHash(ull.geom, 7)
     WHERE cm.circle_id = $1
     ORDER BY u.name`,
    [req.params.circleId]
  )
  const members = result.rows.map((r) => ({
    ...r,
    place_name: r.safe_zone_name || r.geocoded_name || null,
    place_type: r.safe_zone_name ? 'safe_zone' : (r.geocoded_type || null),
  }))
  res.json({ members })
})

// DELETE /api/v1/circles/:circleId/members/:userId — remove member (admin only)
router.delete('/:circleId/members/:userId', authenticate, async (req, res) => {
  const { circleId, userId } = req.params
  const caller = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [circleId, req.user.id])
  if (!caller.rows.length) return res.status(403).json({ error: 'Not a member of this circle' })
  if (caller.rows[0].role !== 'admin') return res.status(403).json({ error: 'Only admins can remove members' })
  if (userId === req.user.id) return res.status(400).json({ error: 'Use leave endpoint to remove yourself' })
  const target = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [circleId, userId])
  if (!target.rows.length) return res.status(404).json({ error: 'Member not found in this circle' })
  if (target.rows[0].role === 'admin') return res.status(400).json({ error: 'Cannot remove another admin' })
  await query('DELETE FROM circle_members WHERE circle_id=$1 AND user_id=$2', [circleId, userId])
  res.json({ success: true })
})

// PATCH /api/v1/circles/:circleId — update circle name (admin only)
router.patch('/:circleId', authenticate, async (req, res) => {
  const { name } = req.body
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' })
  const mem = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [req.params.circleId, req.user.id])
  if (!mem.rows.length) return res.status(403).json({ error: 'Not a member of this circle' })
  if (mem.rows[0].role !== 'admin') return res.status(403).json({ error: 'Only circle admins can rename the circle' })
  const r = await query('UPDATE circles SET name=$1 WHERE id=$2 RETURNING id, name, invite_code', [name.trim(), req.params.circleId])
  if (!r.rows.length) return res.status(404).json({ error: 'Circle not found' })
  res.json({ circle: r.rows[0] })
})

// DELETE /api/v1/circles/:circleId/leave — leave a circle (non-admin)
router.delete('/:circleId/leave', authenticate, async (req, res) => {
  const mem = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [req.params.circleId, req.user.id])
  if (!mem.rows.length) return res.status(404).json({ error: 'You are not a member of this circle' })
  if (mem.rows[0].role === 'admin') {
    const others = await query("SELECT id FROM circle_members WHERE circle_id=$1 AND user_id!=$2 AND role='admin'", [req.params.circleId, req.user.id])
    if (!others.rows.length) return res.status(400).json({ error: 'You are the only admin. Delete the circle or promote another member first.' })
  }
  await query('DELETE FROM circle_members WHERE circle_id=$1 AND user_id=$2', [req.params.circleId, req.user.id])
  res.json({ success: true, message: 'You have left the circle' })
})

// DELETE /api/v1/circles/:circleId/members/:userId — remove a member (admin only)
router.delete('/:circleId/members/:userId', authenticate, async (req, res) => {
  const { circleId, userId } = req.params
  const mem = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [circleId, req.user.id])
  if (!mem.rows.length) return res.status(403).json({ error: 'Not a member of this circle' })
  if (mem.rows[0].role !== 'admin') return res.status(403).json({ error: 'Only admins can remove members' })
  if (userId === req.user.id) return res.status(400).json({ error: 'Use "Leave circle" to remove yourself' })
  const target = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [circleId, userId])
  if (!target.rows.length) return res.status(404).json({ error: 'Member not found in this circle' })
  if (target.rows[0].role === 'admin') return res.status(400).json({ error: 'Cannot remove another admin' })
  await query('DELETE FROM circle_members WHERE circle_id=$1 AND user_id=$2', [circleId, userId])
  res.json({ success: true, message: 'Member removed' })
})

// DELETE /api/v1/circles/:circleId — delete circle (admin only)
router.delete('/:circleId', authenticate, async (req, res) => {
  const mem = await query('SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2', [req.params.circleId, req.user.id])
  if (!mem.rows.length) return res.status(403).json({ error: 'Not a member of this circle' })
  if (mem.rows[0].role !== 'admin') return res.status(403).json({ error: 'Only admins can delete a circle' })
  const r = await query('DELETE FROM circles WHERE id=$1 RETURNING id, name', [req.params.circleId])
  if (!r.rows.length) return res.status(404).json({ error: 'Circle not found' })
  res.json({ deleted: true, circle: r.rows[0] })
})

module.exports = router
