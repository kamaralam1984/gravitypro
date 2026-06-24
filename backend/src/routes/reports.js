// Reports API — weekly aggregates + CSV export.
// Mount at /api/v1/reports (see app.js).
//
// Reuses timeline.js's per-day computation (computeDay) so daily/weekly stay
// in sync. Authorization mirrors timeline: requester must share a circle with
// :userId (or be that user). Relies on safe_zones.category (migration 012):
// home|school|tuition|playground|music|dance|other — stays whose nearest-zone
// category is 'home'/'school' contribute to timeAtHomeSec/timeAtSchoolSec.
const router = require('express').Router()
const { authenticate } = require('../middleware/auth')
const timeline = require('./timeline')

const { computeDay, canView } = timeline

// Local-time YYYY-MM-DD (matches how device_locations are bucketed by to_char).
function toDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Build the last-7-days aggregate ending at `end` (inclusive).
// Returns { userId, start, end, days: [...], totals: {...} }.
async function buildWeekly(userId, end) {
  // Parse end as a local date at midnight to avoid UTC off-by-one.
  const [ey, em, ed] = end.split('-').map(Number)
  const endDate = new Date(ey, em - 1, ed)

  const days = []
  const totals = {
    totalDistanceMeters: 0,
    totalMovingSec: 0,
    timeAtHomeSec: 0,
    timeAtSchoolSec: 0,
  }

  // Iterate 7 days: end-6 .. end (chronological order).
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - i)
    const dateKey = toDateKey(d)
    const { segments, summary } = await computeDay(userId, dateKey)

    // Per-category time-at-place from this day's stays.
    let homeSec = 0
    let schoolSec = 0
    for (const seg of segments) {
      if (seg.type !== 'stay') continue
      if (seg.category === 'home') homeSec += seg.durationSec || 0
      else if (seg.category === 'school') schoolSec += seg.durationSec || 0
    }

    days.push({
      date: dateKey,
      distanceMeters: summary.totalDistanceMeters,
      movingSec: summary.movingSec,
      placesVisited: summary.placesVisited,
      timeAtHomeSec: homeSec,
      timeAtSchoolSec: schoolSec,
    })

    totals.totalDistanceMeters += summary.totalDistanceMeters
    totals.totalMovingSec += summary.movingSec
    totals.timeAtHomeSec += homeSec
    totals.timeAtSchoolSec += schoolSec
  }

  return {
    userId,
    start: days[0] ? days[0].date : end,
    end: toDateKey(endDate),
    days,
    totals,
  }
}

// Validate + resolve the `end` query param (defaults to today, local time).
function resolveEnd(req) {
  const end = String(req.query.end || '')
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null // explicit-but-invalid
  return end || toDateKey(new Date())
}

// CSV escaping: wrap in quotes + double any embedded quotes.
function csvCell(v) {
  const s = String(v == null ? '' : v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /reports/weekly/:userId(.csv)?end=YYYY-MM-DD
// JSON weekly aggregate, OR a text/csv attachment when the path ends in `.csv`.
// Express 5 routes `:userId` greedily (matches dots), so a separate `.csv` route
// would be shadowed — instead we detect the `.csv` suffix inside this one handler.
router.get('/weekly/:userId', authenticate, async (req, res) => {
  let userId = req.params.userId
  let wantCsv = false
  if (userId.endsWith('.csv')) { wantCsv = true; userId = userId.slice(0, -4) }
  const end = resolveEnd(req)
  if (end === null) return res.status(400).json({ error: 'end must be YYYY-MM-DD' })
  if (!(await canView(req.user.id, userId))) {
    return res.status(403).json({ error: 'Not allowed to view this user' })
  }
  const data = await buildWeekly(userId, end)
  if (!wantCsv) return res.json(data)

  const rows = []
  rows.push(['Date', 'Distance (m)', 'Moving (s)', 'Places Visited', 'Time at Home (s)', 'Time at School (s)'])
  for (const d of data.days) {
    rows.push([d.date, d.distanceMeters, d.movingSec, d.placesVisited, d.timeAtHomeSec, d.timeAtSchoolSec])
  }
  // Blank line then totals row.
  rows.push([])
  rows.push([
    'TOTAL',
    data.totals.totalDistanceMeters,
    data.totals.totalMovingSec,
    '',
    data.totals.timeAtHomeSec,
    data.totals.timeAtSchoolSec,
  ])

  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  const filename = `weekly-report-${data.start}_to_${data.end}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
})

module.exports = router
