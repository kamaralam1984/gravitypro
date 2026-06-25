const router = require('express').Router()
const crypto = require('crypto')
const { query } = require('../config/db')
const { authenticate } = require('../middleware/auth')

// Public base used to build the shareable URL. Falls back to the live web host.
const PUBLIC_WEB_BASE =
  process.env.PUBLIC_WEB_BASE || 'https://gravitypro.kvlbusinesssolutions.com'

// How long a share link stays valid.
const SHARE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * POST /api/v1/share  (auth required)
 * Creates a temporary public link to the caller's live location.
 * Returns { token, url, expires_at }.
 */
router.post('/', authenticate, async (req, res) => {
  try {
    // 32 random bytes -> url-safe base64 (no +, /, = chars).
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS)

    await query(
      `INSERT INTO share_links (token, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [token, req.user.id, expiresAt]
    )

    res.json({
      token,
      url: `${PUBLIC_WEB_BASE}/live/${token}`,
      expires_at: expiresAt.toISOString(),
    })
  } catch (err) {
    console.error('[POST /share]', err.message)
    res.status(500).json({ error: 'Failed to create share link' })
  }
})

/**
 * GET /api/v1/share/:token  (PUBLIC — no auth)
 * Polled by the public web page for live updates.
 * - 200 { name, latitude, longitude, updated_at, expires_at } when valid.
 * - 410 { error } when the link has expired.
 * - 404 { error } when the token does not exist.
 */
router.get('/:token', async (req, res) => {
  const { token } = req.params
  try {
    const linkResult = await query(
      `SELECT user_id, expires_at FROM share_links WHERE token = $1`,
      [token]
    )

    if (!linkResult.rows.length) {
      return res.status(404).json({ error: 'Link not found' })
    }

    const link = linkResult.rows[0]
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: 'This live location link has expired' })
    }

    const locResult = await query(
      `SELECT u.name,
              ST_Y(ull.geom::geometry) AS latitude,
              ST_X(ull.geom::geometry) AS longitude,
              ull.updated_at
         FROM users u
         LEFT JOIN user_latest_locations ull ON ull.user_id = u.id
        WHERE u.id = $1`,
      [link.user_id]
    )

    if (!locResult.rows.length) {
      return res.status(404).json({ error: 'User not found' })
    }

    const row = locResult.rows[0]
    res.json({
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      updated_at: row.updated_at,
      expires_at: link.expires_at,
    })
  } catch (err) {
    console.error('[GET /share/:token]', err.message)
    res.status(500).json({ error: 'Failed to load shared location' })
  }
})

/**
 * DELETE /api/v1/share/:token  (auth required, owner only)
 * Revokes a share link early.
 */
router.delete('/:token', authenticate, async (req, res) => {
  const { token } = req.params
  try {
    const result = await query(
      `DELETE FROM share_links WHERE token = $1 AND user_id = $2`,
      [token, req.user.id]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Link not found' })
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[DELETE /share/:token]', err.message)
    res.status(500).json({ error: 'Failed to revoke share link' })
  }
})

module.exports = router
