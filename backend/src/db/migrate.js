require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { getPool } = require('../config/db')

async function migrate() {
  const migrationsDir = path.join(__dirname, '../../migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  const pool = await getPool()

  // Track applied migrations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE filename = $1', [file])
    if (rows.length > 0) {
      console.log(`  skip ${file} (already applied)`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    try {
      await pool.query(sql)
      await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
      console.log(`  ✓ applied ${file}`)
    } catch (err) {
      // Index already exists errors are acceptable on re-run
      if (err.message.includes('already exists')) {
        await pool.query('INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file])
        console.log(`  ✓ ${file} (objects already exist, marked as applied)`)
      } else {
        console.error(`  ✗ ${file} failed: ${err.message}`)
        await pool.end()
        process.exit(1)
      }
    }
  }

  console.log('Migrations complete.')
  await pool.end()
}

migrate()
