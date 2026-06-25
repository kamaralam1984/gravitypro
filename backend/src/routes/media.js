const router = require('express').Router()
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { r2Client, BUCKET } = require('../config/r2')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// Audio types are accepted by the generic /media/upload endpoint (voice notes).
// The R2 presign / avatar / circle-icon endpoints remain image-only.
const AUDIO_TYPES = ['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/aac']
const UPLOAD_TYPES = [...ALLOWED_TYPES, ...AUDIO_TYPES]
const MAX_SIZE = 5 * 1024 * 1024 // 5MB (images / presign)
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 // 10MB (generic upload incl. short voice notes)

// ── Local-disk image storage (no external object store required) ──
// Used as the primary avatar/image path so uploads work without Cloudflare R2.
// Files are written under UPLOAD_DIR and served back by GET /media/file/:name.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads')
const PUBLIC_API_BASE = (process.env.PUBLIC_API_BASE || 'https://gravitypro.kvlbusinesssolutions.com').replace(/\/$/, '')
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac',
}

// POST /media/upload  { dataBase64, contentType }  -> { url }
// Generic upload for images (avatars, child photos, chat images) and audio
// (chat voice notes). Does NOT mutate any user; the caller decides where to
// attach the returned URL. Returned URL is served by GET /media/file/:name.
router.post('/upload', authenticate, async (req, res) => {
  const { dataBase64, contentType } = req.body || {}
  if (!dataBase64) return res.status(400).json({ error: 'dataBase64 required' })
  if (!UPLOAD_TYPES.includes(contentType)) return res.status(400).json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or audio (m4a, mp4, mpeg, aac).' })
  const buf = Buffer.from(dataBase64, 'base64')
  if (!buf.length) return res.status(400).json({ error: 'Empty file' })
  if (buf.length > MAX_UPLOAD_SIZE) return res.status(400).json({ error: 'File too large. Max 10MB.' })
  const dir = path.join(UPLOAD_DIR, 'avatars')
  fs.mkdirSync(dir, { recursive: true })
  const file = `${req.user.id}_${Date.now()}_${uuidv4().slice(0, 8)}.${EXT_BY_TYPE[contentType] || 'jpg'}`
  fs.writeFileSync(path.join(dir, file), buf)
  res.json({ url: `${PUBLIC_API_BASE}/api/v1/media/file/${file}` })
})

// GET /media/file/:name  -> streams a stored image (public, no auth — like a CDN URL)
router.get('/file/:name', (req, res) => {
  const safe = path.basename(req.params.name)
  const fp = path.join(UPLOAD_DIR, 'avatars', safe)
  if (!fp.startsWith(path.join(UPLOAD_DIR, 'avatars')) || !fs.existsSync(fp)) return res.status(404).end()
  res.sendFile(fp)
})

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
