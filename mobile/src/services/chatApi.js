// ── Family Chat API ───────────────────────────────────────────────────────────
// Reuses the shared axios `api` instance (auth token interceptor + baseURL) and
// the existing `mediaAPI.uploadImage` direct-base64 upload endpoint.
//
// Backend contract:
//   GET  /api/v1/chat/:circleId?before=<ISO>&limit=50
//        -> { messages: [ { id, circle_id, sender_id, sender_name, sender_avatar,
//             type:'text'|'image'|'location'|'voice', text, media_url, lat, lng,
//             duration_sec, created_at } ] }   (oldest -> newest)
//   POST /api/v1/chat/:circleId { type, text?, media_url?, lat?, lng?, duration_sec? }
//        -> { message }
//   Real-time: SSE event 'chat_message' (payload = a full message object) on the
//   existing /api/v1/sse/stream the app already connects to.
//
//   Media upload (images + voice) reuses POST /media/upload:
//        { dataBase64, contentType } -> { url }
import api, { mediaAPI } from './api'

export const chatAPI = {
  // Fetch a page of history (oldest -> newest). Pass `before` (ISO string) to
  // page backwards for infinite scroll.
  history: (circleId, before, limit = 50) => {
    const params = new URLSearchParams()
    if (before) params.set('before', before)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return api.get(`/chat/${circleId}${qs ? `?${qs}` : ''}`)
  },

  // Send a message. `body` = { type, text?, media_url?, lat?, lng?, duration_sec? }
  send: (circleId, body) => api.post(`/chat/${circleId}`, body),

  // Upload an image's base64 -> { url }. contentType e.g. 'image/jpeg'.
  uploadImage: (dataBase64, contentType = 'image/jpeg') =>
    mediaAPI.uploadImage({ dataBase64, contentType }),

  // Upload a recorded voice note's base64 -> { url }. Reuses the same endpoint
  // with an audio content type.
  uploadVoice: (dataBase64, contentType = 'audio/m4a') =>
    mediaAPI.uploadImage({ dataBase64, contentType }),
}

export default chatAPI
