// Builds up a road-snapped live trail per family member, incrementally.
//
// On each new GPS fix (own location, or another member's via SSE), gates the
// fix through routeGating.shouldRequestNewSegment — only when the member has
// moved >=25m or changed direction significantly do we call
// /routing/segment for the "last routed point -> new point" leg, then append
// the returned road-snapped coordinates to that member's running path.
//
// In-memory only, scoped to the current app session (see plan: live segments
// go stale within minutes, persisting cross-session adds invalidation
// complexity for no benefit — cross-session/cross-user reuse is the backend's
// route_cache table's job, not this tracker's).
import { routingAPI } from '../services/api'
import { shouldRequestNewSegment, bearingDegrees } from './routeGating'

const MAX_PATH_POINTS = 500

class RouteSegmentTracker {
  constructor() {
    this.members = new Map() // memberId -> { lastRoutedPoint: {lat,lng,bearing}, path: [[lat,lng],...] }
  }

  getPath(memberId) {
    return this.members.get(memberId)?.path || []
  }

  getAllPaths() {
    const out = {}
    this.members.forEach((state, id) => { out[id] = state.path })
    return out
  }

  /** Feed a new fix for `memberId`. Returns that member's updated path (also readable via getPath). */
  async update(memberId, lat, lng) {
    const state = this.members.get(memberId) || { lastRoutedPoint: null, path: [] }

    if (!state.lastRoutedPoint) {
      // First fix for this member this session — nothing to route from yet.
      const seeded = { lastRoutedPoint: { lat, lng, bearing: null }, path: [[lat, lng]] }
      this.members.set(memberId, seeded)
      return seeded.path
    }

    if (!shouldRequestNewSegment(state.lastRoutedPoint, { lat, lng })) {
      return state.path
    }

    const origin = state.lastRoutedPoint
    try {
      const result = await routingAPI.getSegment(origin.lat, origin.lng, lat, lng)
      const bearing = bearingDegrees(origin.lat, origin.lng, lat, lng)
      const coords = result?.coordinates?.length ? result.coordinates : [[origin.lat, origin.lng], [lat, lng]]
      // coords[0] duplicates the path's current last point — drop it when appending.
      const path = [...state.path, ...coords.slice(1)].slice(-MAX_PATH_POINTS)
      this.members.set(memberId, { lastRoutedPoint: { lat, lng, bearing }, path })
      return path
    } catch (err) {
      // Network hiccup — keep the existing path rather than losing history over one failed call.
      return state.path
    }
  }

  // Seed a member's trail with a pre-snapped HISTORICAL route (from the backend
  // timeline route + /routing/path) so the road-following line shows IMMEDIATELY
  // on the live map — before any live movement. Live SSE fixes then append to it.
  // Skips if a live trail has already started, so we never clobber fresher data.
  seed(memberId, coords) {
    if (!Array.isArray(coords) || coords.length < 2) return
    const existing = this.members.get(memberId)
    if (existing && existing.path.length > 1) return
    const last = coords[coords.length - 1]
    this.members.set(memberId, {
      lastRoutedPoint: { lat: last[0], lng: last[1], bearing: null },
      path: coords.slice(-MAX_PATH_POINTS),
    })
  }

  reset(memberId) {
    this.members.delete(memberId)
  }

  clear() {
    this.members.clear()
  }
}

// Singleton — one live-tracking session per app instance, matching how
// MapScreen/FamilyMap already treat member locations as app-session state.
export const routeSegmentTracker = new RouteSegmentTracker()
