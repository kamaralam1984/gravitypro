const { query } = require('../config/db')
const { encodeGeohash } = require('../utils/geohash')
const { haversineMeters } = require('../utils/geo')

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'http://127.0.0.1:5000'

// Cheap insurance against ever hitting the public OSRM demo server — it
// explicitly prohibits production/heavy use and won't hold up at scale.
// This must always be our own self-hosted instance (see osrm/README.md).
if (/project-osrm\.org/i.test(OSRM_BASE_URL)) {
  throw new Error(
    '[routing] OSRM_BASE_URL points at the public OSRM demo server — refusing to start. ' +
    'Set OSRM_BASE_URL to the self-hosted instance (see osrm/README.md).'
  )
}

const ROUTE_TIMEOUT_MS = 3000
const RETRY_DELAYS_MS = [300, 900] // 1 attempt + 2 retries, only on network/timeout/5xx
const MAX_WAYPOINTS_DEFAULT = 200
const MIN_WAYPOINT_SPACING_M = 30

const fetchWithTimeout = (url, ms = ROUTE_TIMEOUT_MS) => {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(tid))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchOsrmOnce = async (url) => {
  const res = await fetchWithTimeout(url)
  if (res.status >= 500) throw new Error(`OSRM ${res.status}`)
  if (!res.ok) {
    // 4xx — bad request, not a transient failure — don't retry.
    throw Object.assign(new Error(`OSRM ${res.status}`), { noRetry: true })
  }
  return res.json()
}

/**
 * Calls OSRM with retry-with-backoff on network error/timeout/5xx (a 4xx —
 * bad coordinates — fails straight through, no point retrying that). Throws
 * on final failure; callers are responsible for the straight-line fallback.
 */
const fetchOsrmWithRetry = async (url) => {
  let lastErr
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchOsrmOnce(url)
    } catch (err) {
      lastErr = err
      if (err.noRetry || attempt === RETRY_DELAYS_MS.length) break
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
  throw lastErr
}

/**
 * Straight-line fallback — same shape as a real snapped route, `snapped:false`
 * tells callers to draw it exactly as they do today (zero visual regression).
 */
const straightLineFallback = (points) => {
  let distanceMeters = 0
  for (let i = 1; i < points.length; i++) {
    distanceMeters += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
  }
  return {
    coordinates: points.map((p) => [p.lat, p.lng]),
    distanceMeters,
    durationSec: null,
    snapped: false,
  }
}

/**
 * OSRM /route/v1/driving/{lng1,lat1};{lng2,lat2}?overview=full&geometries=geojson
 * — note the lng,lat order, opposite of every other coordinate pair in this
 * codebase (timeline.js, device_locations, etc. are all lat,lng).
 */
const callOsrmRoute = async (waypoints, { retry = true } = {}) => {
  const coordsParam = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`
  const data = retry ? await fetchOsrmWithRetry(url) : await fetchOsrmOnce(url)
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(`OSRM response code: ${data.code || 'unknown'}`)
  }
  const route = data.routes[0]
  // GeoJSON coordinates are [lng, lat] — flip to our [lat, lng] convention.
  const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
  return { coordinates, distanceMeters: route.distance, durationSec: route.duration }
}

/**
 * Distance-based downsample (keep a point only once it's >=30m from the last
 * kept point), then evenly sample down to maxWaypoints if still over budget.
 * Mirrors the mobile-side significant-change gating (routeGating.js) so both
 * sides of the system avoid excessive/pointless routing calls.
 */
const downsamplePoints = (points, maxWaypoints) => {
  if (points.length <= 2) return points

  const kept = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const last = kept[kept.length - 1]
    if (haversineMeters(last.lat, last.lng, points[i].lat, points[i].lng) >= MIN_WAYPOINT_SPACING_M) {
      kept.push(points[i])
    }
  }
  kept.push(points[points.length - 1])

  if (kept.length <= maxWaypoints) return kept

  const step = (kept.length - 1) / (maxWaypoints - 1)
  const sampled = []
  for (let i = 0; i < maxWaypoints; i++) {
    sampled.push(kept[Math.round(i * step)])
  }
  return sampled
}

/**
 * Road-snapped route between two points, backed by a geohash-8-keyed cache
 * (route_cache, ~19m cells — matches the 10-20m snap grid the live map's
 * significant-change gating already works at). Never throws — any failure
 * (OSRM down, bad response, etc.) returns a straight-line fallback instead.
 */
const getRoute = async (originLat, originLng, destLat, destLng) => {
  const originHash = encodeGeohash(originLat, originLng, 8)
  const destHash = encodeGeohash(destLat, destLng, 8)

  const cached = await query(
    'SELECT * FROM route_cache WHERE origin_geohash8 = $1 AND dest_geohash8 = $2',
    [originHash, destHash]
  )
  if (cached.rows.length) {
    const row = cached.rows[0]
    query('UPDATE route_cache SET hit_count = hit_count + 1, updated_at = NOW() WHERE id = $1', [row.id]).catch(() => {})
    return {
      coordinates: row.geometry_json,
      distanceMeters: Number(row.distance_meters),
      durationSec: Number(row.duration_sec),
      snapped: true,
    }
  }

  try {
    const result = await callOsrmRoute([
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng },
    ])

    query(
      `INSERT INTO route_cache (origin_geohash8, dest_geohash8, origin_lat, origin_lng, dest_lat, dest_lng, geometry_json, distance_meters, duration_sec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (origin_geohash8, dest_geohash8) DO NOTHING`,
      [originHash, destHash, originLat, originLng, destLat, destLng, JSON.stringify(result.coordinates), result.distanceMeters, result.durationSec]
    ).catch((err) => console.error('[routing] route_cache insert failed:', err.message))

    return { ...result, snapped: true }
  } catch (err) {
    console.error('[routing] getRoute failed, falling back to straight line:', err.message)
    return straightLineFallback([{ lat: originLat, lng: originLng }, { lat: destLat, lng: destLng }])
  }
}

/**
 * Road-snapped route through many points (e.g. a day's raw GPS trail) —
 * downsamples to at most `maxWaypoints` and issues ONE OSRM multi-waypoint
 * call, never one pairwise call per raw point. Not cached (whole-day paths
 * are effectively unique; the per-segment cache above is where the hit rate
 * actually lives). Never throws — falls back to a straight line through the
 * original (non-downsampled) points on any failure.
 */
const getRouteMultiWaypoint = async (points, { maxWaypoints = MAX_WAYPOINTS_DEFAULT } = {}) => {
  if (!points || points.length < 2) {
    return { coordinates: (points || []).map((p) => [p.lat, p.lng]), distanceMeters: 0, durationSec: null, snapped: false }
  }

  const waypoints = downsamplePoints(points, maxWaypoints)

  try {
    const result = await callOsrmRoute(waypoints)
    return { ...result, snapped: true }
  } catch (err) {
    console.error('[routing] getRouteMultiWaypoint failed, falling back to straight line:', err.message)
    return straightLineFallback(points)
  }
}

// ─── Road-snapped distance ───────────────────────────────────────────────────
// Summing haversine between GPS fixes measures the CHORDS of a path, not the
// path: every bend is cut across, so a drive on a curving road always reads
// short. Asking OSRM to match the fixes to the road network and reporting the
// road's own length removes that, and is the last real accuracy gain available
// on the distance number.
//
// Only worth doing for travel that is actually ON roads. Snapping a walk would
// make it WORSE — someone cutting through a park or a gali gets rerouted the
// long way round by car, inventing distance they never travelled. Callers pick;
// see routes/timeline.js, which snaps vehicle segments only.

// A road is never shorter than the straight line between its ends, so a snap
// materially under the chord means OSRM matched the wrong roads. Far over it
// means it invented a detour to reconcile fixes it could not match (common when
// the GPS gaps are large). Neither is trustworthy — fall back rather than
// silently report it.
const SNAP_MIN_RATIO = 0.9
const SNAP_MAX_RATIO = 2.5

const chordDistanceMeters = (points) => {
  let d = 0
  for (let i = 1; i < points.length; i++) {
    d += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
  }
  return d
}

/**
 * Road-snapped length of one travel segment in metres, or null if it could not
 * be snapped trustworthily — OSRM down, region not in the extract (it covers
 * one zone, not all of India — see osrm/README.md), or an implausible result.
 * Never throws. A null means "use your own chord sum", not "no distance".
 *
 * Single attempt, no retry: this runs inside a request the user is waiting on,
 * and a stale-but-instant chord sum beats making them wait out a backoff.
 */
const snapDistanceMeters = async (points, { maxWaypoints = MAX_WAYPOINTS_DEFAULT } = {}) => {
  if (!points || points.length < 2) return null

  const chord = chordDistanceMeters(points)
  if (chord <= 0) return null

  try {
    const { distanceMeters } = await callOsrmRoute(downsamplePoints(points, maxWaypoints), { retry: false })
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null

    const ratio = distanceMeters / chord
    if (ratio < SNAP_MIN_RATIO || ratio > SNAP_MAX_RATIO) {
      console.warn(`[routing] implausible snap (${Math.round(distanceMeters)}m vs ${Math.round(chord)}m chord, ratio ${ratio.toFixed(2)}) — using chord`)
      return null
    }
    return distanceMeters
  } catch (err) {
    console.error('[routing] snapDistanceMeters failed, caller falls back to chord:', err.message)
    return null
  }
}

module.exports = { getRoute, getRouteMultiWaypoint, snapDistanceMeters, SNAP_MIN_RATIO, SNAP_MAX_RATIO }
