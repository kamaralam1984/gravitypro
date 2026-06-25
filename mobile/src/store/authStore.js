import { create } from 'zustand'
import { storage } from '../utils/storage'

export const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    try {
      const token = await storage.getItem('auth_token')
      const userData = await storage.getItem('user_data')
      if (token && userData) {
        set({ token, user: JSON.parse(userData), isAuthenticated: true, isLoading: false })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  login: async (user, token) => {
    await storage.setItem('auth_token', token)
    await storage.setItem('user_data', JSON.stringify(user))
    if (user?.phone) await storage.setItem('user_phone', user.phone)
    set({ user, token, isAuthenticated: true, isLoading: false })
  },

  updateUser: (userData) => {
    const updated = { ...get().user, ...userData }
    storage.setItem('user_data', JSON.stringify(updated))
    set({ user: updated })
  },

  logout: async () => {
    // Stop tracking this user BEFORE clearing the token, so a logged-out (or
    // swapped) account is never tracked and the stale push token is removed.
    try { await require('../services/api').userAPI.clearPushToken() } catch { /* best-effort */ }
    try { await require('../services/location').stopBackgroundTracking() } catch { /* best-effort */ }
    try { require('../services/gpsWatch').default.stop() } catch { /* best-effort */ }
    await storage.deleteItem('auth_token')
    await storage.deleteItem('user_data')
    await storage.deleteItem('user_phone')
    set({ user: null, token: null, isAuthenticated: false })
  },
}))
