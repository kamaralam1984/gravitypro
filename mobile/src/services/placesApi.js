// Places History API client — reuses the shared `api` axios instance from
// services/api.js (so it inherits the auth-token request interceptor and the
// response interceptor that unwraps `res.data`).
//
// Backend: GET /api/v1/places/:userId?days=7
// Returns { userId, days, start, end, places: [
//   { zoneId, name, category, lat, lng, visits, totalDurationSec, lastVisit }
// ] } sorted by totalDurationSec desc.
import api from './api'

// getPlaces(userId, days) -> resolves to the response body (interceptor unwraps).
export async function getPlaces(userId, days = 7) {
  return api.get(`/places/${userId}?days=${encodeURIComponent(days)}`)
}

export default { getPlaces }
