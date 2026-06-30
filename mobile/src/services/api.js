import axios from 'axios'
import { storage } from '../utils/storage'

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com') + '/api/v1'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(async (config) => {
  const token = await storage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res.data,
  async (error) => {
    if (error.response?.status === 401) {
      await storage.deleteItem('auth_token')
      await storage.deleteItem('user_data')
    }
    return Promise.reject(error.response?.data || error)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  sendOtp: (phone) => api.post('/auth/send-otp', { phone }),
  verifyOtp: (phone, otp) => api.post('/auth/verify-otp', { phone, otp }),
  verifyPhone: (phone, otp) => api.post('/auth/verify-phone', { phone, otp }),
  // Email OTP
  sendEmailOtp: (email) => api.post('/auth/send-email-otp', { email }),
  verifyEmail: (email, otp) => api.post('/auth/verify-email', { email, otp }),       // SIGNUP -> { verified, email_token, already_registered }
  verifyEmailOtp: (email, otp) => api.post('/auth/verify-email-otp', { email, otp }), // LOGIN  -> { user, token }
  registerFree: (data) => api.post('/auth/register-free', data),
  register: (data) => api.post('/auth/register', data),
  google: (id_token) => api.post('/auth/google', { id_token }),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (data) => api.patch('/users/me', data),
  getStats: () => api.get('/users/me/stats'),
  postLocation: (data) => api.post('/users/location', data),       // backend: POST /users/location
  updateBattery: (data) => api.patch('/users/location', data),     // backend: PATCH /users/location
  getLocationHistory: () => api.get('/users/me/location-history'),
  registerPushToken: (push_token) => api.post('/users/me/push-token', { token: push_token }),
  search: (phone) => api.get(`/users/search?phone=${encodeURIComponent(phone)}`),
  deleteAccount: () => api.delete('/users/me'),
}

// ── Circles ───────────────────────────────────────────────────────────────────
export const circleAPI = {
  getMy: () => api.get('/circles'),
  getAll: () => api.get('/circles'),
  create: (data) => api.post('/circles', data),
  join: (invite_code) => api.post('/circles/join', { invite_code }),
  getMembers: (circleId) => api.get(`/circles/${circleId}/members`),
  update: (circleId, data) => api.patch(`/circles/${circleId}`, data),
  leave: (circleId) => api.delete(`/circles/${circleId}/leave`),
  remove: (circleId) => api.delete(`/circles/${circleId}`),
  // Admin-only: remove a member from the circle (backend: DELETE /circles/:id/members/:userId).
  removeMember: (circleId, userId) => api.delete(`/circles/${circleId}/members/${userId}`),
  pingMember: (circleId, userId) => api.post(`/circles/${circleId}/members/${userId}/ping`),
}

// ── SOS ───────────────────────────────────────────────────────────────────────
export const sosAPI = {
  trigger: (data) => api.post('/sos', data),
  markSafe: (data = {}) => api.post('/sos/safe', data),            // backend: POST /sos/safe
  getHistory: (circleId) => api.get(`/sos/history?circle_id=${circleId}`),
  resolve: (sosId) => api.patch(`/sos/${sosId}/resolve`),
}

// ── Geofences ─────────────────────────────────────────────────────────────────
export const geofenceAPI = {
  getByCircle: (circleId) => api.get(`/geofences/circle/${circleId}`),
  create: (data) => api.post('/geofences', data),
  update: (id, data) => api.patch(`/geofences/${id}`, data),
  remove: (id) => api.delete(`/geofences/${id}`),
  getEvents: (circleId) => api.get(`/geofences/events/${circleId}`),
}

// ── Media ─────────────────────────────────────────────────────────────────────
// Avatar upload flow:
//   const { uploadUrl, publicUrl, key } = await mediaAPI.presignAvatar({ contentType })
//   await fetch(uploadUrl, { method: 'PUT', body: fileBlob })
//   await mediaAPI.confirmAvatar({ key })   // then userAPI.updateMe({ avatar_url: publicUrl })
export const mediaAPI = {
  presignAvatar: (data) => api.post('/media/avatar/presign', data),
  confirmAvatar: (data) => api.post('/media/avatar/confirm', data),
  presignCircleIcon: (circleId, data) => api.post(`/media/circle/${circleId}/icon/presign`, data),
  confirmCircleIcon: (circleId, data) => api.post(`/media/circle/${circleId}/icon/confirm`, data),
}

// ── Timeline ──────────────────────────────────────────────────────────────────
// Google-Maps-Timeline-style day view for one user.
//   getDays(userId, 'YYYY-MM') -> { days: ['YYYY-MM-DD', ...] }   (which days have data)
//   getDay(userId, 'YYYY-MM-DD') -> { date, segments:[...], summary:{...} }
export const timelineAPI = {
  getDays: (userId, month) => api.get(`/timeline/${userId}/days?month=${encodeURIComponent(month)}`),
  getDay: (userId, date) => api.get(`/timeline/${userId}?date=${encodeURIComponent(date)}`),
}

// ── Parental controls ─────────────────────────────────────────────────────────
// Screen-time (app usage) + app blocking for a child member.
//   getAppUsage(childId, 'YYYY-MM-DD') -> [{ package_name, app_label, foreground_seconds, opens }]
//   getBlockedApps(childId) -> { apps: [{ package_name, app_label, blocked }] }
//   setBlockedApps(childId, apps) -> updates the child's blocked-app list
//   getMyBlockedApps() -> current (child) device's own blocked apps
//   reportAppUsage(date, apps) -> child device reports its usage for a day
export const parentalAPI = {
  getAppUsage: (childId, date) =>
    api.get(`/parental/app-usage/${childId}?date=${encodeURIComponent(date)}`),
  getBlockedApps: (childId) => api.get(`/parental/blocked-apps/${childId}`),
  setBlockedApps: (childId, apps) => api.put(`/parental/blocked-apps/${childId}`, { apps }),
  getMyBlockedApps: () => api.get('/parental/blocked-apps'),
  reportAppUsage: (date, apps) => api.post('/parental/app-usage', { date, apps }),
}

// ── Chat / Messaging ──────────────────────────────────────────────────────────
export const chatAPI = {
  getMessages: (circleId) => api.get(`/chat/circle/${circleId}`),
  sendMessage: (circleId, text) => api.post(`/chat/circle/${circleId}`, { text }),
}

export default api
