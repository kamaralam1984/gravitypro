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
  res.json({ circle, message: 'Joined successfully' })
})

router.get('/:circleId/members', authenticate, async (req, res) => {
  const membership = await query('SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2', [req.params.circleId, req.user.id])
  if (!membership.rows.length) return res.status(403).json({ error: 'Not a circle member' })
  const result = await query(
    `SELECT u.id, u.name, u.phone, u.avatar_url, cm.role, cm.joined_at,
      ull.updated_at as location_updated_at,
      ST_X(ull.geom) as longitude, ST_Y(ull.geom) as latitude,
      ull.battery_level
     FROM circle_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN user_latest_locations ull ON ull.user_id = u.id
     WHERE cm.circle_id = $1
     ORDER BY u.name`,
    [req.params.circleId]
  )
  res.json({ members: result.rows })
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
