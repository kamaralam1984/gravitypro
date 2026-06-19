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
    await storage.setItem('user_phone', user.phone)
    set({ user, token, isAuthenticated: true })
  },

  updateUser: (userData) => {
    const updated = { ...get().user, ...userData }
    storage.setItem('user_data', JSON.stringify(updated))
    set({ user: updated })
  },

  logout: async () => {
    await storage.deleteItem('auth_token')
    await storage.deleteItem('user_data')
    await storage.deleteItem('user_phone')
    set({ user: null, token: null, isAuthenticated: false })
  },
}))
