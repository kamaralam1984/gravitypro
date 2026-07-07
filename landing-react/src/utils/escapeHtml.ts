// Leaflet's bindPopup()/divIcon() render string content via innerHTML, not
// textContent — any HTML/script in a value (e.g. a user's display name) runs
// as real DOM in every viewer's browser. Escape before interpolating into
// any Leaflet HTML template string.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
