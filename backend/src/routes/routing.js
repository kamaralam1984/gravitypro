// Internal routing API — the ONLY way mobile/web ever get road-snapped
// routes. Both proxy to the self-hosted OSRM instance via
// services/routing.js; OSRM itself is bound to 127.0.0.1 and never reachable
// from outside this backend (see osrm/README.md).
//
// Mounted at /api/v1/routing (see app.js).

const router = require('express').Router()
const { z } = require('zod')
const { authenticate } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const { getRoute, getRouteMultiWaypoint } = require('../services/routing')

const segmentSchema = z.object({
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
})

// POST /routing/segment { originLat, originLng, destLat, destLng }
// One pairwise road-snapped route — used by the Live Family Map for
// incremental "last routed point -> new point" extension.
router.post('/segment', authenticate, validate(segmentSchema), async (req, res) => {
  const { originLat, originLng, destLat, destLng } = req.body
  const result = await getRoute(originLat, originLng, destLat, destLng)
  res.json(result)
})

const pathSchema = z.object({
  points: z
    .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .min(2)
    .max(20000),
})

// POST /routing/path { points: [{lat,lng}, ...] }
// A whole trail (e.g. a day's raw GPS points) — server downsamples and issues
// ONE OSRM multi-waypoint call. Used by Timeline/History Replay. Never call
// this per-point-pair; that's what /segment is for.
router.post('/path', authenticate, validate(pathSchema), async (req, res) => {
  const { points } = req.body
  const result = await getRouteMultiWaypoint(points)
  res.json(result)
})

module.exports = router
