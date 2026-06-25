const router = require('express').Router()
const { query } = require('../config/db')
const { ingestLocation } = require('../services/ingestLocation')

// ── Traccar position webhook ───────────────────────────────────────────────────
//
// A self-hosted Traccar server can "forward" every received position to an
// external URL (Settings → Server → Forward, or `forward.*` in traccar.xml /
// notification "Forward" channel). This endpoint receives that forward, maps the
// reporting hardware device -> a GravityPro user (via tracker_devices.device_uid),
// and ingests the position as that user's location — running the SAME
// device_locations insert + geofence check as the phone app.
//
// Traccar's default position-forward JSON looks like:
//   {
//     "event":    { ... },                       // present for event forwards
//     "position": { "latitude": 12.9, "longitude": 77.6, "speed": 0.0,
//                   "course": 90, "altitude": 50, "accuracy": 5,
//                   "deviceTime": "2026-06-24T10:00:00.000+00:00",
//                   "attributes": { "batteryLevel": 88, "battery": 3.9 } },
//     "device":   { "id": 7, "uniqueId": "356938035643809", "name": "Watch" }
//   }
// Older / custom integrations may POST a flat object instead. We handle both.
//
// SECURITY: this endpoint is unauthenticated (Traccar can't carry a JWT). The
// device_uid acts as the shared secret — only positions whose uniqueId has been
// paired in tracker_devices are stored; everything else is acknowledged and
// dropped. For production, also restrict the route to the Traccar host's IP at
// the reverse-proxy layer and/or put a secret path/token in the forward URL.

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null)

// Pull a usable position object + device uid out of whatever shape Traccar sent.
const parsePayload = (body) => {
  if (!body || typeof body !== 'object') return null

  const position = body.position || body
  const device = body.device || {}
  const attrs = position.attributes || body.attributes || {}

  // device unique id (IMEI) — Traccar exposes it as device.uniqueId
  const deviceUid = firstDefined(
    device.uniqueId,
    device.unique_id,
    body.uniqueId,
    body.unique_id,
    body.deviceId,        // some forwarders send numeric id only
    device.id,
    position.deviceId
  )
  if (deviceUid === undefined || deviceUid === null) return null

  const lat = firstDefined(position.latitude, position.lat, body.lat)
  const lon = firstDefined(position.longitude, position.lng, position.lon, body.lon)

  // speed in Traccar is knots; we store it as-is (same as phone payload — unit
  // is treated opaquely downstream). course == heading/bearing.
  const speed = firstDefined(position.speed, body.speed)
  const bearing = firstDefined(position.course, position.bearing, body.course, body.bearing)
  const altitude = firstDefined(position.altitude, body.altitude)
  const accuracy = firstDefined(position.accuracy, attrs.accuracy, body.accuracy)
  const battery = firstDefined(attrs.batteryLevel, attrs.battery, body.batteryLevel, body.battery)
  const timestamp = firstDefined(
    position.fixTime,
    position.deviceTime,
    position.serverTime,
    body.fixTime,
    body.deviceTime,
    body.timestamp
  )

  return { deviceUid: String(deviceUid), lat, lon, speed, bearing, altitude, accuracy, battery, timestamp }
}

router.post('/', async (req, res) => {
  // Always 200 — Traccar retries/queues on non-2xx; we never want to hold up its
  // pipeline for an unknown device or a transient error.
  try {
    const parsed = parsePayload(req.body)
    if (!parsed) return res.json({ success: true, ignored: 'unparseable' })

    const dev = await query(
      'SELECT user_id FROM tracker_devices WHERE device_uid = $1',
      [parsed.deviceUid]
    )
    if (!dev.rows.length) {
      // Unknown / unpaired device — acknowledge and drop.
      return res.json({ success: true, ignored: 'unpaired_device' })
    }

    const userId = dev.rows[0].user_id
    const stored = await ingestLocation(userId, {
      lat: parsed.lat,
      lon: parsed.lon,
      altitude: parsed.altitude,
      accuracy: parsed.accuracy,
      speed: parsed.speed,
      bearing: parsed.bearing,
      battery: parsed.battery,
      timestamp: parsed.timestamp,
    })

    return res.json({ success: true, stored: !!stored })
  } catch (err) {
    console.error('[webhooks/traccar] ingest error:', err.message)
    // Still 200 so Traccar does not retry-storm; we have logged the failure.
    return res.json({ success: true, error: 'logged' })
  }
})

module.exports = router
