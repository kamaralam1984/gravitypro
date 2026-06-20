import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

interface LocationInfo {
  name: string
  avatar_url?: string
  latitude?: number
  longitude?: number
  battery_level?: number
  updated_at?: string
}

export default function Share() {
  const [params] = useSearchParams()
  const uid = params.get('uid') || ''
  const [info, setInfo] = useState<LocationInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setError('No user ID provided'); setLoading(false); return }
    fetch('/api/v1/users/public-location?uid=' + uid)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setInfo(d)
      })
      .catch(e => setError(e.message || 'Could not load location'))
      .finally(() => setLoading(false))
  }, [uid])

  const mapsUrl = info?.latitude && info?.longitude
    ? `https://www.google.com/maps?q=${info.latitude},${info.longitude}`
    : ''

  const timeAgo = (ts?: string) => {
    if (!ts) return 'Unknown'
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago'
    return new Date(ts).toLocaleDateString()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#071a0f', color: '#fff', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* NAV */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid rgba(0,230,118,0.12)', background: 'rgba(7,26,15,0.95)' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <span>📍</span>
          <span style={{ fontWeight: 800, color: '#00E676', letterSpacing: 2, fontSize: '1rem' }}>GRAVITY</span>
        </Link>
        <Link to="/login" style={{ background: '#00E676', color: '#071a0f', padding: '0.4rem 1rem', borderRadius: 6, fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}>Sign In</Link>
      </nav>

      {/* CONTENT */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem' }}>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: '2.5rem 2rem', maxWidth: 420, width: '100%', textAlign: 'center' }}>
          {loading && (
            <div>
              <div style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#00E676', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
              <p style={{ color: 'rgba(255,255,255,0.5)' }}>Loading location…</p>
            </div>
          )}

          {!loading && error && (
            <div>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
              <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Location unavailable</h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>{error === 'Not found' ? 'This location link has expired or the user has disabled sharing.' : error}</p>
              <Link to="/" style={{ color: '#00E676', textDecoration: 'none', fontSize: '0.9rem' }}>← Back to home</Link>
            </div>
          )}

          {!loading && info && (
            <div>
              {/* Avatar */}
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(0,230,118,0.15)', border: '2px solid #00E676', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', overflow: 'hidden', fontSize: '2rem' }}>
                {info.avatar_url ? <img src={info.avatar_url} alt={info.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
              </div>

              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' }}>{info.name}</h2>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                📍 Shared live location · Updated {timeAgo(info.updated_at)}
                {info.battery_level !== undefined && info.battery_level !== null && (
                  <span> · 🔋 {info.battery_level}%</span>
                )}
              </p>

              {info.latitude && info.longitude ? (
                <>
                  <div style={{ background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: 12, padding: '1rem', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.4rem' }}>Coordinates</div>
                    <div style={{ fontFamily: 'monospace', color: '#00E676', fontSize: '1rem' }}>
                      {info.latitude.toFixed(6)}, {info.longitude.toFixed(6)}
                    </div>
                  </div>

                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', background: '#00E676', color: '#071a0f', borderRadius: 10, padding: '0.85rem', fontWeight: 700, textDecoration: 'none', fontSize: '0.95rem', marginBottom: '0.75rem' }}
                  >
                    📍 Open in Google Maps
                  </a>
                </>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', marginBottom: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                  Location not available — device may be offline
                </div>
              )}

              <p style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
                This location is shared via Gravity Family Safety.<br />
                Location updates automatically if the user is online.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Download banner */}
      <div style={{ textAlign: 'center', padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,230,118,0.04)' }}>
        <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.75rem' }}>Want to keep your family safe? Try Gravity for free.</p>
        <Link to="/login" style={{ background: '#00E676', color: '#071a0f', padding: '0.6rem 1.5rem', borderRadius: 8, fontWeight: 700, textDecoration: 'none', fontSize: '0.88rem' }}>Get Started Free →</Link>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
