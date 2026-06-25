import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'

// Leaflet is loaded at runtime from unpkg (same pattern as ParentPanel/ChildPanel).
// We deliberately avoid importing the npm package so this public page stays light.
declare const L: typeof import('leaflet')

interface ShareInfo {
  name: string
  latitude?: number | null
  longitude?: number | null
  updated_at?: string | null
  expires_at: string
}

const POLL_MS = 10_000
const DARK_TILES =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

export default function LiveShare() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<InstanceType<typeof L.Map> | null>(null)
  const markerRef = useRef<InstanceType<typeof L.Marker> | null>(null)

  // ── Poll the public endpoint every POLL_MS ──────────────────────────────────
  useEffect(() => {
    if (!token) {
      setError('No link token provided')
      setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/v1/share/${token}`)
        if (cancelled) return

        if (res.status === 410) {
          setExpired(true)
          setLoading(false)
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Link not found')
        }

        const data: ShareInfo = await res.json()
        if (cancelled) return
        setInfo(data)
        setError('')
        setExpired(false)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message || 'Could not load location')
        setLoading(false)
      }
    }

    load()
    const poll = setInterval(load, POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      cancelled = true
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [token])

  // ── Initialise the Leaflet map once we have coordinates ─────────────────────
  useEffect(() => {
    if (expired || !info?.latitude || !info?.longitude || !mapRef.current) return

    const lat = info.latitude
    const lng = info.longitude

    // Load CSS once.
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    const setup = () => {
      const LL = (window as unknown as { L: typeof import('leaflet') }).L
      if (!LL || !mapRef.current) return

      if (!leafletMapRef.current) {
        const map = LL.map(mapRef.current, {
          center: [lat, lng],
          zoom: 15,
          zoomControl: true,
          attributionControl: false,
        })
        LL.tileLayer(DARK_TILES, { subdomains: 'abcd', maxZoom: 19 }).addTo(map)
        leafletMapRef.current = map
        setTimeout(() => map.invalidateSize(), 150)
      }

      const map = leafletMapRef.current
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        const icon = LL.divIcon({
          className: '',
          html: `<div style="position:relative;width:0;height:0;">
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:56px;height:56px;border-radius:50%;border:2.5px solid #00E676;opacity:0.55;animation:lsPulse 2s ease-out infinite;"></div>
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#00E676;border:3px solid #071a0f;box-shadow:0 0 0 2px #00E676;"></div>
            </div>`,
          iconSize: [0, 0],
        })
        markerRef.current = LL.marker([lat, lng], { icon }).addTo(map!)
      }
      markerRef.current.bindPopup(`<b>${info.name}</b><br/>Live location`)
      map!.setView([lat, lng], map!.getZoom() || 15)
    }

    if ((window as unknown as { L?: unknown }).L) {
      setup()
    } else if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script')
      script.id = 'leaflet-js'
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = setup
      document.head.appendChild(script)
    } else {
      document.getElementById('leaflet-js')?.addEventListener('load', setup)
    }
  }, [info, expired])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const minutesLeft = info
    ? Math.max(0, Math.ceil((new Date(info.expires_at).getTime() - now) / 60000))
    : 0

  // If the countdown hits zero client-side, treat as expired.
  const isExpired = expired || (info != null && minutesLeft <= 0)

  const timeAgo = (ts?: string | null) => {
    if (!ts) return 'unknown'
    const diff = now - new Date(ts).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago'
    return new Date(ts).toLocaleString()
  }

  const hasCoords = info?.latitude != null && info?.longitude != null

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#071a0f',
        color: '#fff',
        fontFamily: 'Inter, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* NAV */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.5rem',
          borderBottom: '1px solid rgba(0,230,118,0.12)',
          background: 'rgba(7,26,15,0.95)',
        }}
      >
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 700,
          }}
        >
          <span style={{ color: '#00E676' }}>●</span> Gravity
        </Link>
        {info && !isExpired && (
          <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
            expires in {minutesLeft} min
          </span>
        )}
      </nav>

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <div
              style={{
                width: 36,
                height: 36,
                border: '3px solid rgba(255,255,255,0.1)',
                borderTopColor: '#00E676',
                borderRadius: '50%',
                animation: 'lsSpin 0.8s linear infinite',
                margin: '0 auto 1rem',
              }}
            />
            <p style={{ color: 'rgba(255,255,255,0.5)' }}>Loading live location…</p>
          </div>
        )}

        {!loading && isExpired && (
          <div style={{ margin: 'auto', textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⏱️</div>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>Link expired</h2>
            <p
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: '0.9rem',
                marginBottom: '1.5rem',
                maxWidth: 360,
              }}
            >
              This live location link is no longer active. Live links expire 30
              minutes after they are created.
            </p>
            <Link to="/" style={{ color: '#00E676', textDecoration: 'none', fontSize: '0.9rem' }}>
              ← Back to home
            </Link>
          </div>
        )}

        {!loading && !isExpired && error && (
          <div style={{ margin: 'auto', textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Location unavailable</h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              {error}
            </p>
            <Link to="/" style={{ color: '#00E676', textDecoration: 'none', fontSize: '0.9rem' }}>
              ← Back to home
            </Link>
          </div>
        )}

        {!loading && !isExpired && !error && info && (
          <>
            {/* Header card */}
            <div
              style={{
                padding: '1rem 1.5rem',
                borderBottom: '1px solid rgba(0,230,118,0.12)',
              }}
            >
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                {info.name}
              </h2>
              <p
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '0.85rem',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#00E676',
                    display: 'inline-block',
                    animation: 'lsBlink 1.4s ease-in-out infinite',
                  }}
                />
                live • updates every 10s · last seen {timeAgo(info.updated_at)}
              </p>
            </div>

            {/* Map */}
            {hasCoords ? (
              <div ref={mapRef} style={{ flex: 1, minHeight: 320, width: '100%' }} />
            ) : (
              <div
                style={{
                  margin: 'auto',
                  textAlign: 'center',
                  padding: '2rem',
                  color: 'rgba(255,255,255,0.4)',
                }}
              >
                Location not available yet — the device may be offline.
              </div>
            )}
          </>
        )}
      </div>

      {/* Download banner */}
      <div
        style={{
          textAlign: 'center',
          padding: '1.25rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,230,118,0.04)',
        }}
      >
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.6rem' }}>
          Shared via Gravity Family Safety.
        </p>
        <Link
          to="/login"
          style={{
            background: '#00E676',
            color: '#071a0f',
            padding: '0.55rem 1.4rem',
            borderRadius: 8,
            fontWeight: 700,
            textDecoration: 'none',
            fontSize: '0.85rem',
          }}
        >
          Get Started Free →
        </Link>
      </div>

      <style>{`
        @keyframes lsSpin { to { transform: rotate(360deg); } }
        @keyframes lsBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes lsPulse {
          0% { transform: translate(-50%,-60%) scale(0.6); opacity: 0.7; }
          100% { transform: translate(-50%,-60%) scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
