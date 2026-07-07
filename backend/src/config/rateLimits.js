// Single source of truth for the global API rate limiter's config, so the
// admin System tab reports the SAME numbers app.js actually enforces
// instead of a hardcoded value that can drift out of sync.
module.exports = {
  GLOBAL_API_WINDOW_MS: 15 * 60 * 1000,
  GLOBAL_API_MAX: 12000,
}
