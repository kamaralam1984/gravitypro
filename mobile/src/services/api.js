import axios from 'axios'
import { storage } from '../utils/storage'

const BASE_URL = __DEV__
  ? 'http://192.168.0.197:3021/api/v1'
  : 'https://gravity.trackalways.com/api/v1'

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

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
}

export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (data) => api.patch('/users/me', data),
  searchByPhone: (phone) => api.get(`/users/search?phone=${phone}`),
}

export const circleAPI = {
  getAll: () => api.get('/circles'),
  create: (data) => api.post('/circles', data),
  join: (invite_code) => api.post('/circles/join', { invite_code }),
  getMembers: (circleId) => api.get(`/circles/${circleId}/members`),
}

export const geofenceAPI = {
  getByCircle: (circleId) => api.get(`/geofences/circle/${circleId}`),
  create: (data) => api.post('/geofences', data),
  delete: (id) => api.delete(`/geofences/${id}`),
  getEvents: (circleId) => api.get('/geofences/events/' + circleId),
}

export const mediaAPI = {
  presignAvatar: (contentType, fileSize) => api.post('/media/avatar/presign', { contentType, fileSize }),
  confirmAvatar: (publicUrl) => api.post('/media/avatar/confirm', { publicUrl }),
  presignCircleIcon: (circleId, contentType, fileSize) => api.post(`/media/circle/${circleId}/icon/presign`, { contentType, fileSize }),
  confirmCircleIcon: (circleId, publicUrl) => api.post(`/media/circle/${circleId}/icon/confirm`, { publicUrl }),
}

export default api
