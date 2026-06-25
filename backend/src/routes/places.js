// Places History API — for one member, the named places they visit
// (Home, School, Tuition, …) with visit counts + total dwell time.
// Mount at /api/v1/places (see app.js).
//
// REUSES timeline.js's per-day computation (computeDay) so stays + their
// nearest-zone name/category stay in sync with the Timeline and Reports views.
// Authorization mirrors timeline/reports: requester must share a circle with
// :userId (or be that user) — via the shared canView helper.
//
// ACCURACY CONTRACT:
//   - Zone-matched stays are grouped by the REAL safe_zones row (zoneId) and
//     carry that zone's actual name + category. We never invent a name.
//   - Stays that matched no zone (computeDay sets place='Unknown', zoneId=null)
//     are collapsed into ONE "Other places" bucket: count + total duration +
//     representative coords only. No fabricated place name.
const router = require('express').Router()
const { authenticate } = require('../middleware/auth')
const timeline = require('./timeline')

const { computeDay, canView } = timeline

// Local-time YYYY-MM-DD (matches how device_locations are bucketed by to_char
// inside computeDay, so the day keys line up exactly).
function toDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Aggregate the last N days of stays into PLACES.
// Returns { userId, days, start, end, places: [...] } sorted by totalDurationSec desc.
async function buildPlaces(userId, days) {
  const n = Math.min(Math.max(1, days | 0), 90) // clamp 1..90
  const end = new Date()
  const dateKeys = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    dateKeys.push(toDateKey(d))
  }

  // zone-matched places keyed by zoneId; unknown stays in one "other" bucket.
  const byZone = new Map() // zoneId -> place aggregate
  const other = { visits: 0, totalDurationSec: 0, lat: null, lng: null, lastVisit: null }

  for (const date of dateKeys) {
    const { segments } = await computeDay(userId, date)
    for (const s of segments) {
      if (s.type !== 'stay') continue
      // computeDay only sets zoneId/place/category when the stay centroid is
      // truly INSIDE the zone polygon; otherwise zoneId is null + place 'Unknown'.
      if (s.zoneId != null) {
        let p = byZone.get(s.zoneId)
        if (!p) {
          p = {
            zoneId: s.zoneId,
            name: s.place, // REAL safe_zones.name
            category: s.category || 'other',
            lat: s.lat,
            lng: s.lng,
            visits: 0,
            totalDurationSec: 0,
            lastVisit: null,
          }
          byZone.set(s.zoneId, p)
        }
        p.visits += 1
        p.totalDurationSec += s.durationSec || 0
        // keep most-recent representative coords + lastVisit
        if (!p.lastVisit || s.leave > p.lastVisit) {
          p.lastVisit = s.leave
          p.lat = s.lat
          p.lng = s.lng
        }
      } else {
        // Unknown stay — no fabricated name, just count + duration + coords.
        other.visits += 1
        other.totalDurationSec += s.durationSec || 0
        if (!other.lastVisit || s.leave > other.lastVisit) {
          other.lastVisit = s.leave
          other.lat = s.lat
          other.lng = s.lng
        }
      }
    }
  }

  const places = Array.from(byZone.values())
  if (other.visits > 0) {
    places.push({
      zoneId: null,
      name: 'Other places',
      category: 'other',
      lat: other.lat,
      lng: other.lng,
      visits: other.visits,
      totalDurationSec: other.totalDurationSec,
      lastVisit: other.lastVisit,
    })
  }

  // Sort by total dwell time desc; "Other places" naturally falls where it lands.
  places.sort((a, b) => b.totalDurationSec - a.totalDurationSec)

  return {
    userId,
    days: n,
    start: dateKeys[0],
    end: dateKeys[dateKeys.length - 1],
    places,
  }
}

// GET /:userId?days=7
// Aggregated places-visited history for the member over the last N days.
router.get('/:userId', authenticate, async (req, res) => {
  const { userId } = req.params
  let days = parseInt(req.query.days, 10)
  if (!Number.isFinite(days)) days = 7
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  try {
    const data = await buildPlaces(userId, days)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not build places history' })
  }
})

module.exports = router
module.exports.buildPlaces = buildPlaces
