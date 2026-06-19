import { create } from 'zustand'

export const useCircleStore = create((set, get) => ({
  circles: [],
  activeCircleId: null,

  setCircles: (circles) => {
    const current = get().activeCircleId
    set({
      circles,
      activeCircleId: current || (circles[0]?.id ?? null),
    })
  },

  setActiveCircle: (circleId) => set({ activeCircleId: circleId }),

  getActiveCircle: () => {
    const { circles, activeCircleId } = get()
    return circles.find(c => c.id === activeCircleId) || null
  },

  addCircle: (circle) => set(state => ({
    circles: [...state.circles, circle],
    activeCircleId: state.activeCircleId || circle.id,
  })),

  removeCircle: (circleId) => set(state => ({
    circles: state.circles.filter(c => c.id !== circleId),
    activeCircleId: state.activeCircleId === circleId
      ? (state.circles[0]?.id ?? null)
      : state.activeCircleId,
  })),
}))
