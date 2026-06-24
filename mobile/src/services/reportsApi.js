// Reports API client (standalone — does not touch services/api.js).
// Talks to backend /api/v1/reports. Reads the same auth_token used by api.js.
import { storage } from '../utils/storage'

const BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com') +
  '/api/v1'

async function authHeaders() {
  const token = await storage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// GET /reports/weekly/:userId?end=YYYY-MM-DD
// Returns { userId, start, end, days: [...], totals: {...} }.
export async function getWeeklyReport(userId, end) {
  const headers = await authHeaders()
  const qs = end ? `?end=${encodeURIComponent(end)}` : ''
  const res = await fetch(`${BASE_URL}/reports/weekly/${userId}${qs}`, { headers })
  if (!res.ok) {
    let msg = `Report request failed (${res.status})`
    try {
      const j = await res.json()
      if (j && j.error) msg = j.error
    } catch (_) {}
    throw new Error(msg)
  }
  return res.json()
}

// Build the CSV download URL with the auth token embedded so it can be opened
// via Linking / a browser (which won't carry our Authorization header).
// The backend's authenticate middleware reads `Authorization: Bearer ...`; for
// link-based downloads we append `?token=` and rely on a token-in-query fallback
// OR open it in an in-app browser that can set headers. We expose both: the
// raw URL plus the headers, so callers can choose.
export async function getWeeklyCsvUrl(userId, end) {
  const qs = end ? `?end=${encodeURIComponent(end)}` : ''
  return `${BASE_URL}/reports/weekly/${userId}.csv${qs}`
}

export async function getCsvAuthHeaders() {
  return authHeaders()
}

export default { getWeeklyReport, getWeeklyCsvUrl, getCsvAuthHeaders }
