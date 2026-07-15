const { query } = require('../config/db')
const { encodeGeohash } = require('../utils/geohash')

const GEOCODE_TIMEOUT_MS = 4000

const fetchWithTimeout = (url, ms = GEOCODE_TIMEOUT_MS) => {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(tid))
}

/**
 * Parses a LocationIQ /v1/reverse response into our POI > Area > Road > City
 * priority (see requirement: never show raw coordinates, never let a road
 * name override a real place name).
 *
 * Also extracts a raw OSM tag (amenity/shop/leisure/tourism, plus religion
 * for place-of-worship disambiguation) as `categoryHint` — a strong signal
 * for Smart Places category inference (see services/smartPlaces.js), used
 * ahead of the weaker time-of-day heuristic when available.
 */
const parseAddress = (data) => {
  const addr = data?.address || {}

  const poi = data?.name || addr.attraction || addr.shop || addr.amenity || addr.building
  const rawTag = addr.amenity || addr.shop || addr.leisure || addr.tourism || null
  const categoryHint = rawTag
    ? (rawTag === 'place_of_worship' && addr.religion ? `place_of_worship:${addr.religion}` : rawTag)
    : null

  if (poi) return { name: poi, type: 'poi', categoryHint }

  const area = addr.suburb || addr.neighbourhood || addr.locality || addr.quarter
  if (area) return { name: area, type: 'area', categoryHint }

  const road = addr.road
  if (road) return { name: road, type: 'road', categoryHint }

  const city = addr.city || addr.town || addr.village || addr.county
  if (city) return { name: city, type: 'city', categoryHint }

  const fallback = data?.display_name ? String(data.display_name).split(',')[0] : 'Unknown area'
  return { name: fallback, type: 'unknown', categoryHint }
}

/**
 * Resolves a human-readable place name for (lat, lng), backed by a
 * geohash-7-keyed cache (geocode_cache), shared across every user/stop that
 * falls in the same ~150m cell.
 *
 * Callers: timelineStops.js on a confirmed stop-close (awaited — the stop needs
 * the name), and warmPlaceName() below (fire-and-forget). Never call this per
 * raw GPS point, and never from a request a client is waiting on: on a cache
 * miss it makes a metered API call.
 */
const resolvePlaceName = async (lat, lng) => {
  const hash = encodeGeohash(lat, lng, 7)

  const cached = await query('SELECT * FROM geocode_cache WHERE geohash7 = $1', [hash])
  if (cached.rows.length) {
    const row = cached.rows[0]
    query('UPDATE geocode_cache SET hit_count = hit_count + 1, updated_at = NOW() WHERE id = $1', [row.id]).catch(() => {})
    return {
      name: row.resolved_name,
      type: row.resolved_type,
      address: row.address_json?.display_name || row.resolved_name,
      categoryHint: row.category_hint,
    }
  }

  const apiKey = process.env.LOCATIONIQ_API_KEY
  if (!apiKey) {
    console.warn('[geocoding] LOCATIONIQ_API_KEY not set — returning fallback place name')
    return { name: 'Unknown area', type: 'unknown', address: null, categoryHint: null }
  }

  try {
    const url = `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lng}&format=json&addressdetails=1&normalizeaddress=1`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`LocationIQ ${res.status}`)
    const data = await res.json()
    const { name, type, categoryHint } = parseAddress(data)

    await query(
      `INSERT INTO geocode_cache (geohash7, lat, lng, resolved_name, resolved_type, category_hint, address_json, raw_response, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'locationiq')
       ON CONFLICT (geohash7) DO NOTHING`,
      [hash, lat, lng, name, type, categoryHint, JSON.stringify(data.address || {}), JSON.stringify(data)]
    )

    return { name, type, address: data.display_name || name, categoryHint }
  } catch (err) {
    console.error('[geocoding] resolvePlaceName failed:', err.message)
    return { name: 'Unknown area', type: 'unknown', address: null, categoryHint: null }
  }
}

// ─── Live "current place" cache warming ──────────────────────────────────────
// GET /circles/:id/members reads place names straight out of geocode_cache and
// never calls the API — it is polled constantly, so a miss must stay cheap. But
// the only thing that ever filled that cache was timelineStops geocoding a
// CLOSED stop, so a child somewhere they had not already stopped at showed no
// place name at all. Warming fills the cache out-of-band: the miss still returns
// null to this poll, and the name is there on a later one.
//
// Guards, because this hangs off a hot polling path onto a metered API:
//  - the key's quota is shared with timelineStops — the feature that genuinely
//    needs it — so warming takes a small slice of the free tier and then yields.
//    Timeline stop names must never break to make a live label appear.
//  - misses are DROPPED, not queued. A skipped warm costs nothing but a later
//    poll; a queue would outlive the request that filled it and stampede.
//  - one in-flight call per cell, so several parents polling the same child
//    collapse into one API call rather than N identical ones.
//  - a cell that fails, or that the provider has no name for, is left alone for
//    a while instead of being retried on every single poll.
const WARM_MIN_INTERVAL_MS = 1100          // free tier allows 2 req/s; stay under 1
const WARM_DAILY_BUDGET = 1500             // of a ~5000/day free tier
const WARM_FAILURE_COOLDOWN_MS = 30 * 60 * 1000
const WARM_FAILED_MAX = 5000               // bound the failure map; it is process-lifetime

const warmInFlight = new Set()
const warmFailedAt = new Map()
let warmNextSlotAt = 0
let warmSpentToday = 0
let warmBudgetDay = ''

const utcDay = () => new Date().toISOString().slice(0, 10)

// Number(null) and Number('') are both 0 — finite, and a perfectly plausible
// coordinate — so a bare Number.isFinite() check waves null coordinates through
// and geocodes Null Island. Reject the empty values first, then bound-check.
const isCoord = (v, limit) =>
  v != null && v !== '' && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limit

/**
 * Fire-and-forget: ensure (lat, lng) has a geocode_cache entry soon. Returns
 * immediately and never throws — callers must not await it. Safe to call on
 * every poll; the guards above decide whether anything actually happens.
 */
const warmPlaceName = (lat, lng) => {
  if (!process.env.LOCATIONIQ_API_KEY) return
  if (!isCoord(lat, 90) || !isCoord(lng, 180)) return

  const today = utcDay()
  if (today !== warmBudgetDay) {
    warmBudgetDay = today
    warmSpentToday = 0
  }
  if (warmSpentToday >= WARM_DAILY_BUDGET) return

  const now = Date.now()
  if (now < warmNextSlotAt) return

  const hash = encodeGeohash(Number(lat), Number(lng), 7)
  if (warmInFlight.has(hash)) return
  const failedAt = warmFailedAt.get(hash)
  if (failedAt != null && now - failedAt < WARM_FAILURE_COOLDOWN_MS) return

  warmNextSlotAt = now + WARM_MIN_INTERVAL_MS
  warmSpentToday++
  warmInFlight.add(hash)

  resolvePlaceName(lat, lng)
    .then((r) => {
      // 'unknown' is what resolvePlaceName returns when the provider gave us
      // nothing usable — treat it as a failure so we stop asking about this cell.
      if (!r || r.type === 'unknown') warmFailedAt.set(hash, Date.now())
      else warmFailedAt.delete(hash)
    })
    .catch(() => warmFailedAt.set(hash, Date.now()))
    .finally(() => {
      warmInFlight.delete(hash)
      if (warmFailedAt.size > WARM_FAILED_MAX) {
        const cutoff = Date.now() - WARM_FAILURE_COOLDOWN_MS
        for (const [k, t] of warmFailedAt) if (t < cutoff) warmFailedAt.delete(k)
      }
    })
}

module.exports = {
  resolvePlaceName,
  parseAddress,
  warmPlaceName,
  WARM_MIN_INTERVAL_MS, // exported so tests can wait out the rate limiter
}
