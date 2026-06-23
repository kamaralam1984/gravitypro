require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')

const authRoutes = require('./routes/auth')
const userRoutes = require('./routes/users')
const circleRoutes = require('./routes/circles')
const locationRoutes = require('./routes/geofences')
const offlineLocationRoutes = require('./routes/locations')
const mediaRoutes = require('./routes/media')
const sseRoutes = require('./routes/sse')
const traccarWebhook = require('./webhooks/traccar')
const { startJobs } = require('./jobs')

const app = express()

app.set('trust proxy', 1)

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use(morgan('combined'))
app.use(express.json({ limit: '10mb' }))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false })
app.use('/api/', limiter)

// Routes
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/users', userRoutes)
app.use('/api/v1/circles', circleRoutes)
app.use('/api/v1/geofences', locationRoutes)
app.use('/api/v1/locations', offlineLocationRoutes)
app.use('/api/v1/media', mediaRoutes)
app.use('/api/v1/sse', sseRoutes)
const sosRoutes = require('./routes/sos')
const adminRoutes = require('./routes/admin')
const paymentRoutes = require('./routes/payments')
const subscriptionRoutes = require('./routes/subscriptions')
app.use('/api/v1/sos', sosRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/payments', paymentRoutes)
app.use('/api/v1/subscriptions', subscriptionRoutes)
const appRoutes = require('./routes/app')
app.use('/api/v1/app', appRoutes)
app.use('/api/v1/timeline', require('./routes/timeline'))
app.use('/api/v1/parental', require('./routes/parental'))
app.use('/webhooks/traccar', traccarWebhook)

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gravity-backend', timestamp: new Date().toISOString() }))

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  const status = err.status || 500
  // Never leak raw internal/DB error messages to clients on 5xx responses.
  const message = status < 500 ? (err.message || 'Request failed') : 'Internal server error'
  res.status(status).json({ error: message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Gravity Backend running on port ${PORT}`)
  startJobs()
})

module.exports = app
