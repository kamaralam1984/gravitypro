// deviceMonitor.js — periodic background scan for DEVICE-OFFLINE alerts.
//
// Every SCAN_INTERVAL_MS it finds device_status rows whose last_location_at is
// older than OFFLINE_AFTER_MS and that haven't already been alerted, then emits
// a 'device_offline' alert via the shared alerts helper (same SSE + push
// delivery as geofence/sos) and sets offline_alerted = true so the alert fires
// once per offline episode.
//
// offline_alerted is reset back to false in routes/locations.js whenever a fresh
// location arrives, so a device that comes back online can trigger again later.
//
// start() is idempotent (guarded against duplicate intervals) and each tick is
// guarded against overlapping/parallel runs.

const { query } = require('../config/db')
const { sendDeviceAlert } = require('./alerts')

const SCAN_INTERVAL_MS = 60 * 1000        // scan every 60s
const OFFLINE_AFTER_MS = 5 * 60 * 1000    // offline = no location for 5 min

let intervalHandle = null
let scanning = false

const scanOnce = async () => {
  if (scanning) return // prevent overlapping ticks
  scanning = true
  try {
    const stale = await query(
      `SELECT user_id
         FROM device_status
        WHERE last_location_at IS NOT NULL
          AND last_location_at < now() - ($1 || ' milliseconds')::interval
          AND offline_alerted = false`,
      [OFFLINE_AFTER_MS]
    )

    for (const row of stale.rows) {
      // Flip the flag first so a concurrent/next tick won't re-alert.
      const upd = await query(
        'UPDATE device_status SET offline_alerted = true, updated_at = now() WHERE user_id = $1 AND offline_alerted = false',
        [row.user_id]
      )
      if (upd.rowCount === 0) continue // already handled

      await sendDeviceAlert(row.user_id, 'device_alert', {
        alertType: 'device_offline',
        title: 'Device offline',
        body: 'No location received for a while. Their device may be off or out of signal.',
      }).catch(e => console.error('[deviceMonitor] offline alert failed:', e.message))
    }
  } catch (err) {
    console.error('[deviceMonitor] scan error:', err.message)
  } finally {
    scanning = false
  }
}

const start = () => {
  if (intervalHandle) return intervalHandle // already started — idempotent
  intervalHandle = setInterval(() => { scanOnce() }, SCAN_INTERVAL_MS)
  if (intervalHandle.unref) intervalHandle.unref() // don't keep the process alive
  console.log('[deviceMonitor] started (scan every %ds, offline after %dmin)',
    SCAN_INTERVAL_MS / 1000, OFFLINE_AFTER_MS / 60000)
  return intervalHandle
}

const stop = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

module.exports = { start, stop, scanOnce }
