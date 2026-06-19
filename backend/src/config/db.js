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
