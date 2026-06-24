// Family API — parent-created child profiles + emergency contacts.
// Reuses the shared axios instance from api.js (auth header + 401 handling +
// response interceptor that already unwraps res.data).
import api from './api'

// ── Child profiles ──────────────────────────────────────────────────────────
//   create({ circle_id, name, dob?, avatar_url?, phone? }) -> { child }
//   list(circleId?) -> { children: [{ id, name, dob, age, avatar_url, ... }] }
//   update(id, { name?, dob? })  -> { child }
export const familyAPI = {
  createChild: (data) => api.post('/family/children', data),
  getChildren: (circleId) =>
    api.get(circleId ? `/family/children?circle_id=${encodeURIComponent(circleId)}` : '/family/children'),
  updateChild: (id, data) => api.patch(`/family/children/${id}`, data),

  // ── Emergency contacts ──────────────────────────────────────────────────────
  //   getContacts() -> { contacts: [{ id, name, phone, relation }] }
  //   addContact({ name, phone?, relation? }) -> { contact }
  //   deleteContact(id) -> { success: true }
  getContacts: () => api.get('/family/emergency-contacts'),
  addContact: (data) => api.post('/family/emergency-contacts', data),
  deleteContact: (id) => api.delete(`/family/emergency-contacts/${id}`),
}

export default familyAPI
