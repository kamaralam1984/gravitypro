import { create } from 'zustand'
import { storage } from '../utils/storage'

const ACTIVE_CIRCLE_KEY = 'active_circle_id'

export const useCircleStore = create((set, get) => ({
  circles: [],
  activeCircleId: null,

  setCircles: (circles) => {
    const current = get().activeCircleId
    const validCurrent = circles.find(c => String(c.id) === String(current))
    const newActiveId = validCurrent ? current : (circles[0]?.id ?? null)
    set({ circles, activeCircleId: newActiveId })
    if (newActiveId) storage.setItem(ACTIVE_CIRCLE_KEY, String(newActiveId)).catch(() => {})
  },

  setActiveCircle: (circleId) => {
    set({ activeCircleId: circleId })
    if (circleId) storage.setItem(ACTIVE_CIRCLE_KEY, String(circleId)).catch(() => {})
    else storage.deleteItem(ACTIVE_CIRCLE_KEY).catch(() => {})
  },

  // Call once on app init to restore last-used circle
  loadActiveCircle: async () => {
    try {
      const stored = await storage.getItem(ACTIVE_CIRCLE_KEY)
      if (stored) set({ activeCircleId: stored })
    } catch {}
  },

  getActiveCircle: () => {
    const { circles, activeCircleId } = get()
    return circles.find(c => String(c.id) === String(activeCircleId)) || null
  },

  addCircle: (circle) => {
    const current = get().activeCircleId
    const newActiveId = current || circle.id
    set(state => ({ circles: [...state.circles, circle], activeCircleId: newActiveId }))
    if (!current) storage.setItem(ACTIVE_CIRCLE_KEY, String(circle.id)).catch(() => {})
  },

  removeCircle: (circleId) => set(state => {
    const remaining = state.circles.filter(c => c.id !== circleId)
    const newActiveId = state.activeCircleId === circleId
      ? (remaining[0]?.id ?? null)
      : state.activeCircleId
    if (state.activeCircleId === circleId) {
      if (newActiveId) storage.setItem(ACTIVE_CIRCLE_KEY, String(newActiveId)).catch(() => {})
      else storage.deleteItem(ACTIVE_CIRCLE_KEY).catch(() => {})
    }
    return { circles: remaining, activeCircleId: newActiveId }
  }),
}))
