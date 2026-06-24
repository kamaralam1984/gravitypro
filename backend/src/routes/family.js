const router = require('express').Router()
const { z } = require('zod')
const { query, getClient } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Whole years between dob and today. Returns null when dob is missing/invalid.
const computeAge = (dob) => {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age < 0 ? null : age
}

// Shape a users row into a child profile response (adds computed age).
const toChild = (row) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  avatar_url: row.avatar_url,
  account_type: row.account_type,
  dob: row.dob,
  age: computeAge(row.dob),
  created_by: row.created_by,
  created_at: row.created_at,
})

const toContact = (row) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  relation: row.relation,
  created_at: row.created_at,
})

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createChildSchema = z.object({
  circle_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  // Accept YYYY-MM-DD (date input / picker). Optional.
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  avatar_url: z.string().url().optional(),
  phone: z.string().min(3).max(20).optional(),
})

const updateChildSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const createContactSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(3).max(20).optional(),
  relation: z.string().max(60).optional(),
})

// ═══ Child profiles ═════════════════════════════════════════════════════════════

// POST /family/children — parent directly creates a child profile + adds to circle.
// NOTE: circle_members.role CHECK allows only ('admin','member'); the child is
// added with role='member' and distinguished by users.account_type='child'.
router.post('/children', authenticate, validate(createChildSchema), async (req, res) => {
  const { circle_id, name, dob, avatar_url, phone } = req.body
  const parentId = req.user.id

  // Parent must be an admin of the target circle to add a child to it.
  const mem = await query(
    'SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2',
    [circle_id, parentId]
  )
  if (!mem.rows.length) return res.status(403).json({ error: 'Not a member of this circle' })
  if (mem.rows[0].role !== 'admin') {
    return res.status(403).json({ error: 'Only circle admins can add children' })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    // password_hash & phone are nullable (migration 009) so parent-created
    // children need no credentials. account_type='child', created_by=parent.
    const childRes = await client.query(
      `INSERT INTO users (name, phone, avatar_url, dob, account_type, created_by)
       VALUES ($1, $2, $3, $4, 'child', $5)
       RETURNING id, name, phone, avatar_url, account_type, dob, created_by, created_at`,
      [name, phone || null, avatar_url || null, dob || null, parentId]
    )
    const child = childRes.rows[0]
    await client.query(
      "INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')",
      [circle_id, child.id]
    )
    await client.query('COMMIT')
    res.status(201).json({ child: toChild(child) })
  } catch (err) {
    await client.query('ROLLBACK')
    // Unique violation on phone (if a real number was reused)
    if (err.code === '23505') return res.status(409).json({ error: 'Phone already in use' })
    console.error('[POST /family/children]', err.message)
    res.status(500).json({ error: 'Failed to create child profile' })
  } finally {
    client.release()
  }
})

// GET /family/children?circle_id= — children created by this parent, optionally
// scoped to a single circle. Includes computed age.
router.get('/children', authenticate, async (req, res) => {
  const parentId = req.user.id
  const { circle_id } = req.query
  try {
    const r = circle_id
      ? await query(
          `SELECT DISTINCT u.id, u.name, u.phone, u.avatar_url, u.account_type,
                  u.dob, u.created_by, u.created_at
             FROM users u
             JOIN circle_members cm ON cm.user_id = u.id
            WHERE u.account_type = 'child'
              AND cm.circle_id = $1
              AND (u.created_by = $2
                   OR EXISTS (SELECT 1 FROM circle_members me
                               WHERE me.circle_id = $1 AND me.user_id = $2))
            ORDER BY u.created_at DESC`,
          [circle_id, parentId]
        )
      : await query(
          `SELECT id, name, phone, avatar_url, account_type, dob, created_by, created_at
             FROM users
            WHERE account_type = 'child' AND created_by = $1
            ORDER BY created_at DESC`,
          [parentId]
        )
    res.json({ children: r.rows.map(toChild) })
  } catch (err) {
    console.error('[GET /family/children]', err.message)
    res.status(500).json({ error: 'Failed to list children' })
  }
})

// PATCH /family/children/:id — update name/dob of a child this parent created.
router.patch('/children/:id', authenticate, validate(updateChildSchema), async (req, res) => {
  const { name, dob } = req.body
  if (name === undefined && dob === undefined) {
    return res.status(400).json({ error: 'Nothing to update' })
  }
  try {
    const r = await query(
      `UPDATE users
          SET name = COALESCE($1, name),
              dob  = COALESCE($2::date, dob),
              updated_at = NOW()
        WHERE id = $3 AND account_type = 'child' AND created_by = $4
        RETURNING id, name, phone, avatar_url, account_type, dob, created_by, created_at`,
      [name ?? null, dob ?? null, req.params.id, req.user.id]
    )
    if (!r.rows.length) {
      return res.status(404).json({ error: 'Child not found or not created by you' })
    }
    res.json({ child: toChild(r.rows[0]) })
  } catch (err) {
    console.error('[PATCH /family/children/:id]', err.message)
    res.status(500).json({ error: 'Failed to update child' })
  }
})

// ═══ Emergency contacts ══════════════════════════════════════════════════════════

// GET /family/emergency-contacts — list contacts owned by the caller.
router.get('/emergency-contacts', authenticate, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, name, phone, relation, created_at
         FROM emergency_contacts
        WHERE owner_user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    )
    res.json({ contacts: r.rows.map(toContact) })
  } catch (err) {
    console.error('[GET /family/emergency-contacts]', err.message)
    res.status(500).json({ error: 'Failed to list emergency contacts' })
  }
})

// POST /family/emergency-contacts — add a contact.
router.post('/emergency-contacts', authenticate, validate(createContactSchema), async (req, res) => {
  const { name, phone, relation } = req.body
  try {
    const r = await query(
      `INSERT INTO emergency_contacts (owner_user_id, name, phone, relation)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, relation, created_at`,
      [req.user.id, name, phone || null, relation || null]
    )
    res.status(201).json({ contact: toContact(r.rows[0]) })
  } catch (err) {
    console.error('[POST /family/emergency-contacts]', err.message)
    res.status(500).json({ error: 'Failed to add emergency contact' })
  }
})

// DELETE /family/emergency-contacts/:id — remove a contact (owner-scoped).
router.delete('/emergency-contacts/:id', authenticate, async (req, res) => {
  try {
    const r = await query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND owner_user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Contact not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[DELETE /family/emergency-contacts/:id]', err.message)
    res.status(500).json({ error: 'Failed to delete emergency contact' })
  }
})

module.exports = router
