const { Pool } = require('pg')
const { promises: dns } = require('dns')
const { URL } = require('url')

let _pool = null

async function getPool() {
  if (_pool) return _pool

  const dbUrl = new URL(process.env.DATABASE_URL)
  const hostname = dbUrl.hostname
  const isNeon = hostname.includes('neon.tech')

  let host = hostname
  if (isNeon) {
    try {
      const addrs = await dns.resolve4(hostname)
      host = addrs[0]
    } catch (_) {}
  }

  _pool = new Pool({
    host,
    port: parseInt(dbUrl.port) || 5432,
    database: dbUrl.pathname.slice(1),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    ssl: isNeon ? { rejectUnauthorized: false, servername: hostname } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // This app is India-only (IN phone numbers, temple/mosque/gurdwara zone
    // categories, IST users). Without this, the session timezone defaults to
    // UTC on Neon/most managed Postgres, so every `::date` cast and
    // `to_char(ts, 'YYYY-MM-DD')` boundary (timeline day view, daily/weekly
    // summaries, "Today"/"Yesterday" filters) resolves calendar-day
    // boundaries in UTC — off by 5:30 from the user's actual local day.
    // TIMESTAMPTZ columns still store/compare as UTC internally either way;
    // this only fixes which "midnight" a bare date means.
    options: '-c timezone=Asia/Kolkata',
  })

  _pool.on('error', (err) => {
    console.error('Unexpected database error', err)
    process.exit(-1)
  })

  return _pool
}

const query = async (text, params) => {
  const pool = await getPool()
  return pool.query(text, params)
}

const getClient = async () => {
  const pool = await getPool()
  return pool.connect()
}

module.exports = { query, getClient, getPool }
