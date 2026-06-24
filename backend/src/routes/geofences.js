const router = require('express').Router()
const { z } = require('zod')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')

const ZONE_CATEGORIES = ['home', 'school', 'tuition', 'playground', 'music', 'dance', 'other']
const categorySchema = z.enum(ZONE_CATEGORIES)

const createZoneSchema = z.object({
  circle_id: z.string().uuid(),
  name: z.string().min(2).max(100),
  center_lat: z.number(),
  center_lng: z.number(),
  radius_meters: z.number().min(50).max(50000),
  // null / omitted => zone applies to the whole circle (shared)
  assigned_user_id: z.string().uuid().nullable().optional(),
  category: categorySchema.optional(),
})

// GET all safe zones for a circle
router.get('/circle/:circleId', authenticate, async (req, res) => {
  const membership = await query(
    'SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2',
    [req.params.circleId, req.user.id]
  )
  if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })
  const result = await query(
    `SELECT sz.id, sz.name, sz.radius_meters, sz.created_at,
       sz.assigned_user_id, sz.category,
       u.name as assigned_user_name,
       ST_AsGeoJSON(sz.geom)::json as geometry,
       ST_X(ST_Centroid(sz.geom)) as center_lng,
       ST_Y(ST_Centroid(sz.geom)) as center_lat
     FROM safe_zones sz
     LEFT JOIN users u ON u.id = sz.assigned_user_id
     WHERE sz.circle_id = $1 ORDER BY sz.created_at DESC`,
    [req.params.circleId]
  )
  res.json({ safe_zones: result.rows })
})

// GET geofence events for a circle (for Alerts screen)
router.get('/events/:circleId', authenticate, async (req, res) => {
  const { limit = 50, offset = 0 } = req.query
  const membership = await query(
    'SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2',
    [req.params.circleId, req.user.id]
  )
  if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })
  const result = await query(
    `SELECT
       ge.id, ge.event_type, ge.created_at,
       u.id as user_id, u.name as user_name, u.avatar_url,
       sz.name as zone_name, sz.id as zone_id,
       ST_X(ge.geom) as longitude, ST_Y(ge.geom) as latitude
     FROM geofence_events ge
     JOIN users u ON u.id = ge.user_id
     JOIN safe_zones sz ON sz.id = ge.safe_zone_id
     WHERE sz.circle_id = $1
     ORDER BY ge.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.params.circleId, parseInt(limit), parseInt(offset)]
  )
  res.json({ events: result.rows, total: result.rowCount })
})

// POST create safe zone
router.post('/', authenticate, validate(createZoneSchema), async (req, res) => {
  const { circle_id, name, center_lat, center_lng, radius_meters } = req.body
  const assigned_user_id = req.body.assigned_user_id ?? null
  const category = req.body.category ?? 'other'
  const membership = await query(
    'SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2',
    [circle_id, req.user.id]
  )
  if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })

  // If a member is assigned, they must belong to this circle.
  if (assigned_user_id) {
    const assignee = await query(
      'SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2',
      [circle_id, assigned_user_id]
    )
    if (!assignee.rows.length) return res.status(400).json({ error: 'Assigned member is not in this circle' })
  }

  const result = await query(
    `INSERT INTO safe_zones (circle_id, name, geom, radius_meters, created_by, assigned_user_id, category)
     VALUES ($1, $2,
       ST_Buffer(ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)::geometry,
       $5, $6, $7, $8)
     RETURNING id, name, radius_meters, created_at, assigned_user_id, category,
     ST_X(ST_Centroid(geom)) as center_lng,
     ST_Y(ST_Centroid(geom)) as center_lat`,
    [circle_id, name, center_lng, center_lat, radius_meters, req.user.id, assigned_user_id, category]
  )
  res.status(201).json({ safe_zone: result.rows[0] })
})

// PATCH edit safe zone
const updateZoneSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  center_lat: z.number().optional(),
  center_lng: z.number().optional(),
  radius_meters: z.number().min(50).max(50000).optional(),
  // null => unassign (back to circle-wide / shared)
  assigned_user_id: z.string().uuid().nullable().optional(),
  category: categorySchema.optional(),
})

router.patch('/:id', authenticate, validate(updateZoneSchema), async (req, res) => {
  const zone = await query(
    `SELECT sz.id, sz.name, sz.radius_meters, sz.circle_id,
       sz.assigned_user_id, sz.category,
       ST_X(ST_Centroid(sz.geom)) as center_lng,
       ST_Y(ST_Centroid(sz.geom)) as center_lat,
       cm.role
     FROM safe_zones sz
     JOIN circle_members cm ON cm.circle_id = sz.circle_id
     WHERE sz.id = $1 AND cm.user_id = $2`,
    [req.params.id, req.user.id]
  )
  if (!zone.rows.length) return res.status(403).json({ error: 'Access denied' })

  const current = zone.rows[0]
  const name = req.body.name ?? current.name
  const lat = req.body.center_lat ?? current.center_lat
  const lng = req.body.center_lng ?? current.center_lng
  const radius = req.body.radius_meters ?? current.radius_meters
  const category = req.body.category ?? current.category
  // assigned_user_id: only change if the key is present; allow explicit null to unassign.
  const assigned_user_id = ('assigned_user_id' in req.body)
    ? req.body.assigned_user_id
    : current.assigned_user_id

  // If a member is assigned, they must belong to this zone's circle.
  if (assigned_user_id) {
    const assignee = await query(
      'SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2',
      [current.circle_id, assigned_user_id]
    )
    if (!assignee.rows.length) return res.status(400).json({ error: 'Assigned member is not in this circle' })
  }

  const result = await query(
    `UPDATE safe_zones
     SET name = $1,
         geom = ST_Buffer(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)::geometry,
         radius_meters = $4,
         assigned_user_id = $6,
         category = $7
     WHERE id = $5
     RETURNING id, name, radius_meters, created_at, assigned_user_id, category,
       ST_X(ST_Centroid(geom)) as center_lng,
       ST_Y(ST_Centroid(geom)) as center_lat`,
    [name, lng, lat, radius, req.params.id, assigned_user_id, category]
  )
  res.json({ safe_zone: result.rows[0] })
})

// DELETE safe zone
router.delete('/:id', authenticate, async (req, res) => {
  const zone = await query(
    `SELECT sz.id, cm.role FROM safe_zones sz
     JOIN circle_members cm ON cm.circle_id = sz.circle_id
     WHERE sz.id = $1 AND cm.user_id = $2`,
    [req.params.id, req.user.id]
  )
  if (!zone.rows.length) return res.status(403).json({ error: 'Access denied' })
  await query('DELETE FROM safe_zones WHERE id = $1', [req.params.id])
  res.json({ success: true })
})

module.exports = router
