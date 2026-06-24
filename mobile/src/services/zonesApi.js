// Per-child safe-zone helpers.
//
// We do NOT edit services/api.js. The existing geofenceAPI already forwards the
// full request body, so assigned_user_id + category pass through unchanged. This
// module wraps geofenceAPI/circleAPI with zone-assignment-aware helpers and owns
// the category metadata shared by SafeZonesScreen.

import { geofenceAPI, circleAPI } from './api'

// category values must match backend migration 012 / geofences.js ZONE_CATEGORIES
export const ZONE_CATEGORIES = [
  { value: 'home', label: 'Home', icon: 'home' },
  { value: 'school', label: 'School', icon: 'school' },
  { value: 'tuition', label: 'Tuition', icon: 'book' },
  { value: 'playground', label: 'Playground', icon: 'football' },
  { value: 'music', label: 'Music', icon: 'musical-notes' },
  { value: 'dance', label: 'Dance', icon: 'body' },
  { value: 'other', label: 'Other', icon: 'shield-checkmark' },
]

export const categoryMeta = (value) =>
  ZONE_CATEGORIES.find((c) => c.value === value) || ZONE_CATEGORIES[ZONE_CATEGORIES.length - 1]

export const zonesApi = {
  // Returns { safe_zones: [...] } — each zone now also has
  // assigned_user_id, category, assigned_user_name (null when shared).
  list: (circleId) => geofenceAPI.getByCircle(circleId),

  // payload: { circle_id, name, center_lat, center_lng, radius_meters,
  //            assigned_user_id?: uuid|null, category?: string }
  create: (payload) => geofenceAPI.create(payload),

  // patch: any subset of { name, center_lat, center_lng, radius_meters,
  //         assigned_user_id (null to unassign / make shared), category }
  update: (id, patch) => geofenceAPI.update(id, patch),

  remove: (id) => geofenceAPI.remove(id),

  // Circle members — used to populate the "Assign to" picker.
  members: (circleId) => circleAPI.getMembers(circleId),
}

// Group an array of zones by their assigned member.
// Returns [{ key, name, userId, zones: [...] }, ...] with shared zones first.
export const groupZonesByMember = (zones, members = []) => {
  const memberName = (id) => {
    const m = (members || []).find((x) => x.id === id)
    return m?.name || m?.email || 'Member'
  }
  const shared = []
  const byMember = new Map()
  for (const z of zones || []) {
    if (!z.assigned_user_id) {
      shared.push(z)
    } else {
      if (!byMember.has(z.assigned_user_id)) byMember.set(z.assigned_user_id, [])
      byMember.get(z.assigned_user_id).push(z)
    }
  }
  const groups = []
  if (shared.length) groups.push({ key: 'shared', name: 'Shared (whole family)', userId: null, zones: shared })
  for (const [userId, zs] of byMember.entries()) {
    groups.push({
      key: userId,
      name: zs[0].assigned_user_name || memberName(userId),
      userId,
      zones: zs,
    })
  }
  return groups
}

export default zonesApi
