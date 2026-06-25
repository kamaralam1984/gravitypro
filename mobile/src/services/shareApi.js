// Share Live Location API
// Reuses the shared axios `api` instance (auth token injected via interceptor).
// The response interceptor already unwraps `res.data`, so these return the body.
import api from './api'

export const shareApi = {
  /**
   * Create a temporary public live-location link (valid 30 min).
   * @returns {Promise<{ token: string, url: string, expires_at: string }>}
   */
  createShare: () => api.post('/share'),

  /**
   * Revoke a previously created share link early.
   * @param {string} token
   */
  revokeShare: (token) => api.delete(`/share/${token}`),
}

export default shareApi
