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
 * geohash-7-keyed cache (geocode_cache). Only ever called once per confirmed
 * stop-close (see timelineStops.js) — never per raw GPS point — and shared
 * across every user/stop that falls in the same ~150m cell.
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

module.exports = { resolvePlaceName, parseAddress }
