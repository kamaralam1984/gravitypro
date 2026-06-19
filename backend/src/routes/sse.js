const router = require('express').Router()
const jwt = require('jsonwebtoken')
const { query } = require('../config/db')
const { addClient, removeClient } = require('../services/sse')

// SSE needs special auth — token can come from query param (EventSource limitation)
router.get('/stream', async (req, res) => {
  try {
    // Try header first, then query param
    let token = null
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    } else if (req.query.token) {
      token = req.query.token
    }
    if (!token) return res.status(401).json({ error: 'No token' })

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const result = await query('SELECT id, name, phone, email, avatar_url, push_token, country_code FROM users WHERE id = $1', [decoded.userId])
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' })

    const user = result.rows[0]
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    res.write(`data: ${JSON.stringify({ type: 'connected', userId: user.id })}\n\n`)
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n') } catch(e) {} }, 25000)
    addClient(user.id, res)
    req.on('close', () => {
      clearInterval(keepAlive)
      removeClient(user.id, res)
    })
  } catch(e) {
    res.status(401).json({ error: 'Invalid token' })
  }
})

module.exports = router
