const router = require('express').Router()
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { r2Client, BUCKET } = require('../config/r2')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { v4: uuidv4 } = require('uuid')

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

router.post('/avatar/presign', authenticate, async (req, res) => {
  const { contentType, fileSize } = req.body
  if (!ALLOWED_TYPES.includes(contentType)) return res.status(400).json({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' })
  if (fileSize > MAX_SIZE) return res.status(400).json({ error: 'File too large. Max 5MB.' })
  const ext = contentType.split('/')[1]
  const key = `avatars/${req.user.id}/${uuidv4()}.${ext}`
  const command = new PutObjectCommand({
    Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: fileSize,
  })
  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 })
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`
  res.json({ uploadUrl, key, publicUrl })
})

router.post('/avatar/confirm', authenticate, async (req, res) => {
  const { publicUrl } = req.body
  if (!publicUrl) return res.status(400).json({ error: 'publicUrl required' })
  await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [publicUrl, req.user.id])
  res.json({ avatar_url: publicUrl })
})

router.post('/circle/:circleId/icon/presign', authenticate, async (req, res) => {
  const { circleId } = req.params
  const { contentType, fileSize } = req.body
  const membership = await query('SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, req.user.id])
  if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })
  if (!ALLOWED_TYPES.includes(contentType)) return res.status(400).json({ error: 'Invalid file type' })
  if (fileSize > MAX_SIZE) return res.status(400).json({ error: 'File too large. Max 5MB.' })
  const ext = contentType.split('/')[1]
  const key = `circles/${circleId}/icon-${uuidv4()}.${ext}`
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: fileSize })
  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 })
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`
  res.json({ uploadUrl, key, publicUrl })
})

router.post('/circle/:circleId/icon/confirm', authenticate, async (req, res) => {
  const { circleId } = req.params
  const { publicUrl } = req.body
  const membership = await query('SELECT role FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, req.user.id])
  if (!membership.rows.length) return res.status(403).json({ error: 'Access denied' })
  await query('UPDATE circles SET icon_url = $1, updated_at = NOW() WHERE id = $2', [publicUrl, circleId])
  res.json({ icon_url: publicUrl })
})

module.exports = router
