// Check-In API client.
// Reuses the shared axios instance from services/api.js (auth header injection,
// 401 handling, and the response interceptor that already unwraps res.data) —
// same pattern as familyApi.js.
import api from './api'

// send({ circle_id?, type, message?, lat?, lng? }) -> { checkins: [...] }
//   type is one of: home | school | tuition | office | safe (free text allowed).
//   Omit circle_id to broadcast to every circle the user belongs to.
// getForCircle(circleId, limit?) -> { checkins: [...] }
export const checkinsApi = {
  send: (body) => api.post('/checkins', body),
  getForCircle: (circleId, limit) =>
    api.get(`/checkins/circle/${circleId}${limit ? `?limit=${limit}` : ''}`),
}

export default checkinsApi
