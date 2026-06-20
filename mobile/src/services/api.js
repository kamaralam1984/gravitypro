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
  registerFree: (data) => api.post('/auth/register-free', data),
  register: (data) => api.post('/auth/register', data),
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (data) => api.patch('/users/me', data),
  getStats: () => api.get('/users/me/stats'),
  postLocation: (data) => api.post('/users/me/location', data),
  getLocationHistory: () => api.get('/users/me/location-history'),
}

// ── Circles ───────────────────────────────────────────────────────────────────
export const circleAPI = {
  getMy: () => api.get('/circles/my'),
  getAll: () => api.get('/circles/my'),
  create: (data) => api.post('/circles', data),
  join: (invite_code) => api.post('/circles/join', { invite_code }),
  getMembers: (circleId) => api.get(`/circles/${circleId}/members`),
  removeMember: (circleId, userId) => api.delete(`/circles/${circleId}/members/${userId}`),
}

// ── SOS ───────────────────────────────────────────────────────────────────────
export const sosAPI = {
  trigger: (data) => api.post('/sos/trigger', data),
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
// Usage:
//   const { uploadUrl, publicUrl } = await mediaAPI.getAvatarUploadUrl()
//   await fetch(uploadUrl, { method: 'PUT', body: fileBlob })
//   await userAPI.updateMe({ avatar_url: publicUrl })
export const mediaAPI = {
  getAvatarUploadUrl: () => api.get('/media/avatar-upload-url'),
}

// ── Subscriptions ─────────────────────────────────────────────────────────────
export const subscriptionAPI = {
  getMe: () => api.get('/subscriptions/me'),
  cancel: () => api.post('/subscriptions/cancel'),
  getHistory: () => api.get('/subscriptions/history'),
}

export default api
