// Minimal geohash encoder (no dependency). Precision 7 ≈ 152m x 152m cells,
// used as the reverse-geocode cache key (see services/geocoding.js) — close
// enough to the 100m stop-detection radius that consecutive visits to the
// same place reliably land in the same cell.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

const encodeGeohash = (lat, lng, precision = 7) => {
  let latRange = [-90, 90]
  let lngRange = [-180, 180]
  let isEven = true
  let bit = 0
  let ch = 0
  let hash = ''

  while (hash.length < precision) {
    if (isEven) {
      const mid = (lngRange[0] + lngRange[1]) / 2
      if (lng >= mid) { ch |= (1 << (4 - bit)); lngRange[0] = mid } else { lngRange[1] = mid }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2
      if (lat >= mid) { ch |= (1 << (4 - bit)); latRange[0] = mid } else { latRange[1] = mid }
    }
    isEven = !isEven
    if (bit < 4) {
      bit++
    } else {
      hash += BASE32[ch]
      bit = 0
      ch = 0
    }
  }
  return hash
}

module.exports = { encodeGeohash }
