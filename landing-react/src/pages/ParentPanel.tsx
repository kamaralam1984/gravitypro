import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from './ParentPanel.module.css'

// ── TYPES ──
interface Member {
  id: string
  name: string
  lat: number | null
  lng: number | null
  status: 'active' | 'sos' | 'offline'
  battery: number
  color: string
  avatar: string
  role: string
  lastSeen: string
}

interface AlertItem {
  id: string
  type: 'sos' | 'geo' | 'batt'
  icon: string
  title: string
  subtitle: string
  time: string
  dismissed: boolean
}

interface Zone {
  id: string
  name: string
  address: string
  radius: number
  active: boolean
}

// ── LEAFLET DYNAMIC IMPORT ──
declare const L: typeof import('leaflet')

const API_BASE = window.location.origin + '/api/v1'

function getToken(): string | null { return localStorage.getItem('gravity_token') }
function getUser(): { name?: string; email?: string; avatar_url?: string } | null {
  try { return JSON.parse(localStorage.getItem('gravity_user') || 'null') } catch { return null }
}

async function apiGet(path: string) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + token } })
  if (res.status === 401) { localStorage.clear(); return null }
  return res.json()
}

async function apiPost(path: string, body: unknown) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export default function ParentPanel() {
  const navigate = useNavigate()
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<InstanceType<typeof L.Map> | null>(null)
  const tileLayerRef = useRef<InstanceType<typeof L.TileLayer> | null>(null)
  const memberMarkersRef = useRef<Record<string, InstanceType<typeof L.Marker>>>({})
  const mapInitedRef = useRef(false)

  const [activeTab, setActiveTab] = useState<'map' | 'family' | 'alerts' | 'geofence' | 'settings'>('map')
  const [mapType, setMapType] = useState<'dark' | 'light' | 'satellite' | 'street'>('dark')
  const [members, setMembers] = useState<Member[]>([])
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [circleId, setCircleId] = useState<string | null>(null)
  const [familyCount, setFamilyCount] = useState('Loading...')
  const [zoneSubtitle, setZoneSubtitle] = useState('Loading...')
  const [userName, setUserName] = useState('Loading...')
  const [userEmail, setUserEmail] = useState('')
  const [userAvatar, setUserAvatar] = useState('https://picsum.photos/seed/gravity-parent/60/60')
  const [toastMsg, setToastMsg] = useState('')
  const [toastType, setToastType] = useState('success')
  const [toastVisible, setToastVisible] = useState(false)
  const [showZoneModal, setShowZoneModal] = useState(false)
  const [znName, setZnName] = useState('')
  const [znLat, setZnLat] = useState('')
  const [znLng, setZnLng] = useState('')
  const [znRadius, setZnRadius] = useState('200')
  const [segmentVal, setSegmentVal] = useState('Exact')
  const [notifCount, setNotifCount] = useState(0)

  // ── AUTH GUARD ──
  useEffect(() => {
    if (!getToken()) {
      localStorage.setItem('gravity_redirect', 'parent-panel')
      navigate('/login')
    }
  }, [navigate])

  // ── INIT USER PROFILE ──
  useEffect(() => {
    const user = getUser()
    if (user) {
      setUserName(user.name || 'User')
      setUserEmail(user.email || '')
      if (user.avatar_url) setUserAvatar(user.avatar_url)
    }
  }, [])

  // ── LEAFLET MAP ──
  useEffect(() => {
    if (activeTab !== 'map') return
    if (mapInitedRef.current) {
      setTimeout(() => leafletMapRef.current?.invalidateSize(), 150)
      return
    }
    if (!mapRef.current) return

    // Dynamically load leaflet CSS if needed
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    // Load leaflet script
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => {
      if (mapInitedRef.current || !mapRef.current) return
      mapInitedRef.current = true
      const map = (window as unknown as { L: typeof import('leaflet') }).L.map(mapRef.current, {
        center: [20.5937, 78.9629],
        zoom: 5,
        zoomControl: false,
        attributionControl: false,
      })
      leafletMapRef.current = map
      const TILE_LAYERS = {
        dark:      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        light:     'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        street:    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      }
      const L2 = (window as unknown as { L: typeof import('leaflet') }).L
      tileLayerRef.current = L2.tileLayer(TILE_LAYERS.dark, { subdomains: 'abcd', maxZoom: 19 }).addTo(map)
      setTimeout(() => map.invalidateSize(), 100)
    }
    if (!document.getElementById('leaflet-js')) {
      script.id = 'leaflet-js'
      document.head.appendChild(script)
    } else {
      script.onload(new Event('load'))
    }
  }, [activeTab])

  // ── MAP MARKERS ──
  useEffect(() => {
    if (!leafletMapRef.current || !members.length) return
    const L2 = (window as unknown as { L: typeof import('leaflet') }).L
    if (!L2) return
    Object.values(memberMarkersRef.current).forEach((mk) => leafletMapRef.current!.removeLayer(mk))
    memberMarkersRef.current = {}
    const located = members.filter((m) => m.lat && m.lng)
    located.forEach((m) => {
      const color = m.color
      const icon = L2.divIcon({
        className: '',
        html: `<div style="position:relative;text-align:center;width:46px;">
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:56px;height:56px;border-radius:50%;border:2.5px solid ${color};opacity:0.6;animation:markerPulse 2s ease-out infinite;z-index:0;pointer-events:none;"></div>
          <div style="position:relative;z-index:1;width:40px;height:40px;border-radius:50%;overflow:hidden;border:3px solid ${color};box-shadow:0 4px 14px rgba(0,0,0,0.7),0 0 14px ${color}55;margin:0 auto;">
            <img src="${m.avatar}" width="40" height="40" style="display:block;object-fit:cover;"/>
          </div>
          <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid ${color};margin:-1px auto 0;position:relative;z-index:1;"></div>
        </div>`,
        iconSize: [46, 56],
        iconAnchor: [23, 56],
      })
      const marker = L2.marker([m.lat!, m.lng!], { icon }).addTo(leafletMapRef.current!)
      marker.bindPopup(
        `<div style="font-family:'Plus Jakarta Sans',sans-serif;background:#0D1F13;color:#fff;border:1px solid rgba(0,230,118,0.2);border-radius:10px;padding:10px;min-width:140px;">
          <div style="font-weight:800;font-size:13px;color:${color};margin-bottom:4px;">${m.name}</div>
          <div style="font-size:11px;color:#5E8B6E;margin-bottom:2px;">${m.role}</div>
          <div style="font-size:10px;color:#5E8B6E;margin-top:4px;">🔋 ${m.battery}%</div>
        </div>`,
        { className: 'custom-popup' }
      )
      memberMarkersRef.current[m.id] = marker
    })
    if (located.length >= 2) {
      leafletMapRef.current.fitBounds(located.map((m) => [m.lat!, m.lng!] as [number, number]), { padding: [40, 40] })
    } else if (located.length === 1) {
      leafletMapRef.current.setView([located[0].lat!, located[0].lng!], 14)
    }
    setTimeout(() => leafletMapRef.current?.invalidateSize(), 100)
  }, [members, activeTab])

  // ── MAP TYPE SWITCH ──
  function switchMapType(type: typeof mapType) {
    if (!leafletMapRef.current) return
    const L2 = (window as unknown as { L: typeof import('leaflet') }).L
    if (!L2) return
    if (tileLayerRef.current) leafletMapRef.current.removeLayer(tileLayerRef.current)
    const TILE_LAYERS: Record<string, string> = {
      dark:      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      light:     'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      street:    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    }
    tileLayerRef.current = L2.tileLayer(TILE_LAYERS[type], { subdomains: 'abcd', maxZoom: 19 }).addTo(leafletMapRef.current)
    tileLayerRef.current.bringToBack()
    setMapType(type)
  }

  function mapZoomIn() { leafletMapRef.current?.setZoom((leafletMapRef.current.getZoom() || 5) + 1, { animate: true }) }
  function mapZoomOut() { leafletMapRef.current?.setZoom((leafletMapRef.current.getZoom() || 5) - 1, { animate: true }) }

  // ── LOAD DATA ──
  useEffect(() => {
    loadRealData()
    // Reveal fallback
    setTimeout(() => {
      document.querySelectorAll(`.${styles.reveal}`).forEach((el) => el.classList.add('visible'))
    }, 300)
  }, [])

  async function loadRealData() {
    try {
      const data = await apiGet('/circles')
      if (!data?.circles?.length) { setFamilyCount('No circle yet'); return }
      const cid = data.circles[0].id
      setCircleId(cid)
      await Promise.all([loadMembers(cid), loadAlerts(cid), loadGeofences(cid)])
      connectSSE(cid)
    } catch (e) { console.error('loadRealData error', e) }
  }

  async function loadMembers(cid: string) {
    const data = await apiGet('/circles/' + cid + '/members')
    if (!data) return
    const colors = ['#00E676', '#00C853', '#29B6F6', '#FFB300', '#AB47BC', '#5E8B6E']
    const loaded: Member[] = (data.members || []).map((m: Record<string, unknown>, i: number) => ({
      id: m.id as string,
      name: m.name as string,
      lat: m.latitude ? parseFloat(m.latitude as string) : null,
      lng: m.longitude ? parseFloat(m.longitude as string) : null,
      status: m.location_updated_at ? 'active' : 'offline',
      battery: m.battery_level != null ? Math.round(m.battery_level as number) : 50,
      color: colors[i % colors.length],
      avatar: (m.avatar_url as string) || 'https://picsum.photos/seed/' + encodeURIComponent(m.name as string) + '/56/56',
      role: (m.role as string) || 'Member',
      lastSeen: m.location_updated_at ? new Date(m.location_updated_at as string).toLocaleTimeString() : 'Unknown',
    }))
    setMembers(loaded)
    const active = loaded.filter((m) => m.status === 'active').length
    setFamilyCount(loaded.length + ' member' + (loaded.length !== 1 ? 's' : '') + ' · ' + active + ' active')
  }

  async function loadAlerts(cid: string) {
    const data = await apiGet('/geofences/events/' + cid)
    if (!data?.events?.length) return
    const icons: Record<string, string> = { exit: '🚨', entry: '📍', sos: '🆘' }
    const labels: Record<string, (z: string) => string> = {
      exit: (z) => 'Left ' + z,
      entry: (z) => 'Arrived at ' + z,
      sos: () => 'SOS Alert',
    }
    const typeMap: Record<string, AlertItem['type']> = { exit: 'geo', entry: 'geo', sos: 'sos' }
    const loaded: AlertItem[] = data.events.slice(0, 10).map((e: Record<string, unknown>) => ({
      id: 'alert-' + e.id,
      type: typeMap[e.event_type as string] || 'geo',
      icon: icons[e.event_type as string] || '📍',
      title: (e.user_name || 'Member') + ' — ' + (labels[e.event_type as string] || (() => e.event_type))( e.zone_name as string || ''),
      subtitle: '',
      time: new Date(e.created_at as string).toLocaleString(),
      dismissed: false,
    }))
    setAlerts(loaded)
    setNotifCount(loaded.length)
  }

  async function loadGeofences(cid: string) {
    const data = await apiGet('/geofences/circle/' + cid)
    if (!data?.safe_zones) { setZoneSubtitle('Could not load zones'); return }
    if (!data.safe_zones.length) { setZoneSubtitle('0 zones · tap + to add'); return }
    const loaded: Zone[] = data.safe_zones.map((z: Record<string, unknown>) => ({
      id: z.id as string,
      name: z.name as string,
      address: 'Radius: ' + z.radius_meters + 'm',
      radius: z.radius_meters as number,
      active: true,
    }))
    setZones(loaded)
    setZoneSubtitle(loaded.length + ' zone' + (loaded.length !== 1 ? 's' : '') + ' active')
  }

  function connectSSE(cid: string) {
    const token = getToken()
    if (!token || !cid) return
    const evtSource = new EventSource(API_BASE + '/sse/stream?token=' + token)
    evtSource.addEventListener('location_update', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setMembers((prev) =>
        prev.map((m) =>
          m.id === d.userId ? { ...m, lat: d.latitude, lng: d.longitude, battery: d.battery_level || m.battery } : m
        )
      )
      if (memberMarkersRef.current[d.userId]) {
        memberMarkersRef.current[d.userId].setLatLng([d.latitude, d.longitude])
      }
    })
    evtSource.addEventListener('sos_alert', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      showToast('🆘 SOS from ' + (d.userName || 'Member') + '!', 'error')
      const newAlert: AlertItem = {
        id: 'alert-sos-' + Date.now(),
        type: 'sos',
        icon: '🆘',
        title: (d.userName || 'Member') + ' sent SOS alert',
        subtitle: d.latitude ? d.latitude.toFixed(4) + ', ' + d.longitude.toFixed(4) : '',
        time: 'Just now',
        dismissed: false,
      }
      setAlerts((prev) => [newAlert, ...prev])
      setNotifCount((c) => c + 1)
      setActiveTab('alerts')
    })
    evtSource.onerror = () => evtSource.close()
  }

  // ── TOAST ──
  function showToast(msg: string, type = 'success') {
    setToastMsg(msg)
    setToastType(type)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }

  function callMember(name: string) { showToast('📞 Calling ' + name + '...', 'call') }
  function msgMember(name: string) { showToast('💬 Message sent to ' + name, 'msg') }

  // ── ALERT DISMISS ──
  function dismissAlert(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    setNotifCount((c) => Math.max(0, c - 1))
  }

  // ── GEOFENCE ACTIONS ──
  function toggleZone(id: string, checked: boolean) {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, active: checked } : z)))
  }

  function openZoneModal() {
    setZnName('')
    setZnRadius('200')
    if (leafletMapRef.current) {
      const c = leafletMapRef.current.getCenter()
      setZnLat(c.lat.toFixed(6))
      setZnLng(c.lng.toFixed(6))
    } else {
      setZnLat('')
      setZnLng('')
    }
    setShowZoneModal(true)
  }

  async function submitNewZone() {
    const name = znName.trim()
    const lat = parseFloat(znLat)
    const lng = parseFloat(znLng)
    const radius = parseInt(znRadius)
    if (!name) { showToast('Zone name required', 'error'); return }
    if (isNaN(lat) || isNaN(lng)) { showToast('Valid coordinates required', 'error'); return }
    if (!radius || radius < 50) { showToast('Radius must be at least 50m', 'error'); return }
    if (!circleId) { showToast('No circle selected', 'error'); return }
    try {
      const res = await apiPost('/geofences', { circle_id: circleId, name, center_lat: lat, center_lng: lng, radius_meters: radius })
      if (res?.safe_zone) {
        setShowZoneModal(false)
        showToast('Safe zone created!', 'success')
        await loadGeofences(circleId)
      } else {
        showToast(res?.error || 'Failed to create zone', 'error')
      }
    } catch { showToast('Network error', 'error') }
  }

  async function deleteZone(zoneId: string) {
    if (!confirm('Delete this safe zone?')) return
    try {
      const token = getToken()
      const res = await fetch(API_BASE + '/geofences/' + zoneId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) { showToast('Zone deleted', 'success'); if (circleId) await loadGeofences(circleId) }
      else showToast('Failed to delete zone', 'error')
    } catch { showToast('Network error', 'error') }
  }

  // ── SETTINGS ACTIONS ──
  function doLogout() {
    if (confirm('Logout?')) {
      localStorage.removeItem('gravity_token')
      localStorage.removeItem('gravity_user')
      navigate('/login')
    }
  }
  function confirmLeave() {
    if (confirm('Are you sure you want to leave the Family Circle?')) alert('You have left the Family Circle.')
  }
  function confirmDelete() {
    if (confirm('Are you sure you want to permanently delete your account? This action cannot be undone.')) {
      alert('Account deletion initiated. A confirmation email will be sent.')
    }
  }

  // ── HELPERS ──
  function battColor(pct: number) { return pct > 60 ? '#00E676' : pct > 20 ? '#FFB300' : '#FF5252' }

  return (
    <div className={styles.pageWrap}>
      {/* Floating background orbs */}
      <div className={`${styles.bgOrb} ${styles.bgOrb1}`}></div>
      <div className={`${styles.bgOrb} ${styles.bgOrb2}`}></div>
      <div className={`${styles.bgOrb} ${styles.bgOrb3}`}></div>

      {/* TOAST */}
      <div className={`${styles.toast} ${toastVisible ? styles.toastShow : ''} ${toastType === 'call' ? styles.toastCall : toastType === 'msg' ? styles.toastMsg : toastType === 'error' ? styles.toastError : ''}`}>
        {toastMsg}
      </div>

      <div className={styles.appFrame} id="appFrame">

        {/* PHONE NOTCH */}
        <div className={styles.phoneNotch}>
          <div className={styles.phoneNotchCam}></div>
        </div>

        {/* STATUS BAR */}
        <div className={styles.statusBar}>
          <span className={styles.statusTime}>9:41</span>
          <div className={styles.statusIcons}>
            <div className={styles.signalBars}>
              <span></span><span></span><span></span><span></span>
            </div>
            <svg width="15" height="11" viewBox="0 0 15 11" fill="none" style={{ margin: '0 2px' }}>
              <path d="M7.5 2.5C9.5 2.5 11.3 3.3 12.6 4.6L14 3.2C12.3 1.5 10 0.5 7.5 0.5C5 0.5 2.7 1.5 1 3.2L2.4 4.6C3.7 3.3 5.5 2.5 7.5 2.5Z" fill="white" />
              <path d="M7.5 5.5C8.8 5.5 9.9 6 10.7 6.8L12.1 5.4C10.9 4.2 9.3 3.5 7.5 3.5C5.7 3.5 4.1 4.2 2.9 5.4L4.3 6.8C5.1 6 6.2 5.5 7.5 5.5Z" fill="white" />
              <circle cx="7.5" cy="9.5" r="1.5" fill="white" />
            </svg>
            <div className={styles.statusBattery}>
              <div className={styles.batteryIcon}><div className={styles.batteryFill}></div></div>
              <span style={{ fontSize: '11px', fontWeight: 700 }}>79</span>
            </div>
          </div>
        </div>

        {/* APP HEADER */}
        <div className={styles.appHeader}>
          <div className={styles.headerLeft}>
            <Link to="/" className={styles.headerBack}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              Home
            </Link>
            <div className={styles.headerBrand}>
              <div className={styles.navLogoIcon}>
                <svg className={styles.logoSvg} width="28" height="28" viewBox="0 0 40 40" fill="none">
                  <defs>
                    <linearGradient id="pinGradP" x1="12" y1="4" x2="28" y2="26" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#00FFB2" />
                      <stop offset="100%" stopColor="#00C853" />
                    </linearGradient>
                  </defs>
                  <path d="M20 4C14.48 4 10 8.48 10 14c0 8.5 10 22 10 22s10-13.5 10-22c0-5.52-4.48-10-10-10z" fill="url(#pinGradP)" />
                  <circle cx="20" cy="13.5" r="3.5" fill="rgba(5,12,8,0.85)" />
                </svg>
              </div>
              <span className={styles.navLogoText}>GRAVITY</span>
              <span className={styles.parentBadge}>Parent</span>
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.notifBtn} onClick={() => setActiveTab('alerts')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {notifCount > 0 && <div className={styles.notifBadge}>{notifCount}</div>}
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className={styles.appContent} id="appContent">

          {/* TAB 1: MAP */}
          <div className={`${styles.tabSection} ${activeTab === 'map' ? styles.tabSectionActive : ''}`}>
            <div className={styles.mapWrapper}>
              <div ref={mapRef} className={styles.leafletMap} id="leaflet-map"></div>

              {/* Map type switcher */}
              <div className={styles.mapTypeSwitcher}>
                {(['dark', 'light', 'satellite', 'street'] as const).map((t) => (
                  <button
                    key={t}
                    className={`${styles.mapTypeBtn} ${mapType === t ? styles.mapTypeBtnActive : ''}`}
                    onClick={() => switchMapType(t)}
                  >
                    <span className="mti">{t === 'dark' ? '🌙' : t === 'light' ? '☀️' : t === 'satellite' ? '🛰️' : '🗺️'}</span>
                    {t.charAt(0).toUpperCase() + t.slice(1, 3)}
                  </button>
                ))}
              </div>

              {/* Custom zoom controls */}
              <div className={styles.mapZoomCtrl}>
                <button className={styles.mapZoomBtn} onClick={mapZoomIn}>+</button>
                <button className={styles.mapZoomBtn} onClick={mapZoomOut}>−</button>
              </div>

              <div className={styles.mapTopBar}>
                <div className={styles.mapPill}>
                  <div className={styles.liveDot}></div>
                  LIVE TRACKING
                </div>
                <div className={styles.mapPill} style={{ color: '#29B6F6' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  Updated now
                </div>
              </div>
            </div>

            <div className={styles.familyStripWrap}>
              <div className={styles.familyStripLabel}>Family Members</div>
              <div className={styles.familyStrip}>
                {members.map((m) => (
                  <div
                    key={m.id}
                    className={styles.memberMiniCard}
                    onClick={() => { if (leafletMapRef.current && m.lat && m.lng) leafletMapRef.current.setView([m.lat, m.lng], 15) }}
                  >
                    <div className={styles.memberMiniAvatar}>
                      <img src={m.avatar} alt={m.name} style={{ borderColor: m.color }} />
                      <div className={styles.memberMiniStatus} style={{ background: m.status === 'active' ? '#00E676' : '#5E8B6E' }}></div>
                    </div>
                    <div className={styles.memberMiniName}>{m.name.split(' ')[0]}</div>
                    <div className={styles.memberMiniDist}>{m.status === 'active' ? 'Online' : 'Offline'}</div>
                  </div>
                ))}
                {!members.length && <span style={{ color: '#5E8B6E', fontSize: 12, padding: '8px' }}>No members yet</span>}
              </div>
            </div>

            <div className={styles.mapInfoSection}>
              <div className={styles.sectionTitle}>Location Overview</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.map((m) => {
                  const bc = battColor(m.battery)
                  const statusText = m.status === 'active' ? 'Active' : m.status === 'sos' ? 'SOS' : 'Offline'
                  const statusColor = m.status === 'active' ? '#00E676' : m.status === 'sos' ? '#FF5252' : '#5E8B6E'
                  return (
                    <div key={m.id} className={styles.reveal} style={{ background: '#0D1F13', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 14, padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={m.avatar} alt={m.name} style={{ width: 36, height: 36, borderRadius: '50%', border: `2px solid ${m.color}`, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 2, lineHeight: 1.4 }}>{m.name} <span style={{ fontSize: 10, fontWeight: 600, color: '#5E8B6E' }}>{m.role}</span></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: m.battery + '%', background: bc, borderRadius: 3 }}></div>
                          </div>
                          <span style={{ fontSize: 9, fontWeight: 700, color: bc }}>{m.battery}%</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: statusColor, background: statusColor + '18', border: `1px solid ${statusColor}44`, padding: '2px 7px', borderRadius: 10 }}>{statusText}</div>
                        <div style={{ fontSize: 9, color: '#5E8B6E' }}>{m.lastSeen !== 'Unknown' ? '🕐 ' + m.lastSeen : '—'}</div>
                      </div>
                    </div>
                  )
                })}
                {!members.length && <p style={{ color: '#5E8B6E', textAlign: 'center', padding: 16, fontSize: 13 }}>No members yet</p>}
              </div>
            </div>
          </div>

          {/* TAB 2: FAMILY */}
          <div className={`${styles.tabSection} ${activeTab === 'family' ? styles.tabSectionActive : ''}`}>
            <div style={{ padding: '16px 16px 8px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Family Circle</div>
              <div style={{ fontSize: 12, color: '#5E8B6E', lineHeight: 1.5 }}>{familyCount}</div>
            </div>
            <div className={styles.familyList}>
              {members.map((m, idx) => {
                const bc = battColor(m.battery)
                const statusText = m.status === 'active' ? 'Active' : m.status === 'sos' ? 'SOS' : 'Offline'
                const statusClass = m.status === 'active' ? styles.statusActive : m.status === 'sos' ? styles.statusSos : styles.statusAway
                return (
                  <div key={m.id} className={`${styles.memberCard} ${styles.reveal}`} style={{ transitionDelay: idx * 0.06 + 's' }}>
                    <div className={styles.rippleContainer}></div>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: '18px 0 0 18px', background: m.color }}></div>
                    <div className={styles.memberAvatar}>
                      <img src={m.avatar} alt={m.name} style={{ borderColor: m.color }} />
                    </div>
                    <div className={styles.memberInfo}>
                      <div className={styles.memberNameRow}>
                        <div className={styles.memberName}>{m.name}</div>
                        <div className={styles.memberRole}>{m.role}</div>
                      </div>
                      <div className={styles.memberLocation}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                        </svg>
                        {m.lat ? 'Location tracked' : 'No location yet'}
                      </div>
                      <div className={styles.memberLastseen}>Last seen: {m.lastSeen}</div>
                      <div className={styles.batteryRow}>
                        <div className={styles.batteryBarWrap}>
                          <div className={styles.batteryBar} style={{ width: m.battery + '%', background: bc }}></div>
                        </div>
                        <span className={styles.batteryPct} style={{ color: bc }}>{m.battery}%</span>
                      </div>
                      <div className={styles.memberActions}>
                        <button className={`${styles.memberBtn} ${styles.memberBtnCall}`} onClick={(e) => { e.stopPropagation(); callMember(m.name) }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.7 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.59a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                          Call
                        </button>
                        <button className={`${styles.memberBtn} ${styles.memberBtnMsg}`} onClick={(e) => { e.stopPropagation(); msgMember(m.name) }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          Message
                        </button>
                      </div>
                    </div>
                    <div className={styles.memberRight}>
                      <div className={`${styles.statusBadge} ${statusClass}`}>{statusText}</div>
                      <span className={styles.chevronIcon}>›</span>
                    </div>
                  </div>
                )
              })}
              {!members.length && <p style={{ color: '#5E8B6E', textAlign: 'center', padding: 24, fontSize: 13 }}>No family members yet</p>}
            </div>
          </div>

          {/* TAB 3: ALERTS */}
          <div className={`${styles.tabSection} ${activeTab === 'alerts' ? styles.tabSectionActive : ''}`}>
            <div className={styles.alertsHeaderBar}>
              <div>
                <div className={styles.alertsCountTitle}>Active Alerts</div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginTop: 2 }}>Requires your attention</div>
              </div>
              <div className={styles.alertsCountBadge}>{alerts.length}</div>
            </div>
            <div className={styles.alertList}>
              {!alerts.length && <div style={{ textAlign: 'center', color: '#5E8B6E', padding: '40px 20px', fontSize: 13 }}>No alerts yet</div>}
              {alerts.map((a) => (
                <div key={a.id} className={`${styles.alertCard} ${a.type === 'sos' ? styles.alertCardSos : a.type === 'geo' ? styles.alertCardGeo : styles.alertCardBatt}`}>
                  <div className={styles.alertTop}>
                    <div className={`${styles.alertIcon} ${a.type === 'sos' ? styles.alertIconSos : styles.alertIconGeo}`}>{a.icon}</div>
                    <div className={styles.alertTextWrap}>
                      <div className={styles.alertTitle}>{a.title}</div>
                      {a.subtitle && <div className={styles.alertSubtitle}>{a.subtitle}</div>}
                      <div className={styles.alertTime}>{a.time}</div>
                    </div>
                  </div>
                  <div className={styles.alertActions}>
                    <button className={`${styles.alertBtn} ${styles.alertBtnGhost}`} onClick={() => dismissAlert(a.id)}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TAB 4: GEOFENCE */}
          <div className={`${styles.tabSection} ${activeTab === 'geofence' ? styles.tabSectionActive : ''}`}>
            <div className={styles.geofenceHeader}>
              <div>
                <div className={styles.geofenceTitle}>Safe Zones</div>
                <div className={styles.geofenceSubtitle}>{zoneSubtitle}</div>
              </div>
              <button className={styles.geoAddBtn} onClick={openZoneModal}>+ Add Zone</button>
            </div>
            <div className={styles.zoneList}>
              {!zones.length && !zoneSubtitle.startsWith('Loading') && (
                <div style={{ textAlign: 'center', color: '#5E8B6E', padding: '40px 20px', fontSize: 13 }}>No safe zones yet — tap + Add Zone</div>
              )}
              {zones.map((z, i) => (
                <div key={z.id} className={`${styles.zoneCard} ${styles.reveal}`} style={{ transitionDelay: i * 0.08 + 's', opacity: z.active ? 1 : 0.6 }}>
                  <div className={styles.zoneTop}>
                    <div className={styles.zoneIconWrap}>📍</div>
                    <div className={styles.zoneInfo}>
                      <div className={styles.zoneName}>{z.name}</div>
                      <div className={styles.zoneAddress}>{z.address}</div>
                    </div>
                    <div className={styles.zoneToggleWrap}>
                      <label className={styles.toggleSwitch}>
                        <input type="checkbox" checked={z.active} onChange={(e) => toggleZone(z.id, e.target.checked)} />
                        <span className={styles.toggleSlider}></span>
                      </label>
                    </div>
                  </div>
                  <div className={styles.zoneBottom}>
                    <div className={styles.zoneRadiusTag}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /></svg>
                      {z.radius}m radius
                    </div>
                    <div className={styles.zoneActions}>
                      <button className={styles.zoneActionBtn} title="Delete" onClick={() => deleteZone(z.id)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
              <div className={`${styles.addZoneCard} ${styles.reveal}`} style={{ transitionDelay: zones.length * 0.08 + 's' }} onClick={openZoneModal}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add New Safe Zone
              </div>
            </div>

            {/* Add Zone Modal */}
            {showZoneModal && (
              <div className={styles.modalOverlay}>
                <div className={styles.modalBox}>
                  <div className={styles.modalTitle}>New Safe Zone</div>
                  <div className={styles.modalFields}>
                    <div>
                      <div className={styles.modalFieldLabel}>Zone Name</div>
                      <input className={styles.modalInput} type="text" placeholder="e.g. Home, School" value={znName} onChange={(e) => setZnName(e.target.value)} />
                    </div>
                    <div className={styles.modalRow}>
                      <div className={styles.modalHalf}>
                        <div className={styles.modalFieldLabel}>Latitude</div>
                        <input className={styles.modalInput} type="number" step="any" placeholder="28.6139" value={znLat} onChange={(e) => setZnLat(e.target.value)} />
                      </div>
                      <div className={styles.modalHalf}>
                        <div className={styles.modalFieldLabel}>Longitude</div>
                        <input className={styles.modalInput} type="number" step="any" placeholder="77.2090" value={znLng} onChange={(e) => setZnLng(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <div className={styles.modalFieldLabel}>Radius (meters)</div>
                      <input className={styles.modalInput} type="number" placeholder="200" min="50" max="5000" value={znRadius} onChange={(e) => setZnRadius(e.target.value)} />
                    </div>
                    <div className={styles.modalTip}>Tip: Open Google Maps, long-press a location and copy the coordinates.</div>
                  </div>
                  <div className={styles.modalActions}>
                    <button className={styles.modalCancelBtn} onClick={() => setShowZoneModal(false)}>Cancel</button>
                    <button className={styles.modalCreateBtn} onClick={submitNewZone}>Create Zone</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* TAB 5: SETTINGS */}
          <div className={`${styles.tabSection} ${activeTab === 'settings' ? styles.tabSectionActive : ''}`}>
            <div className={styles.settingsProfile}>
              <div className={styles.settingsAvatarWrap}>
                <img src={userAvatar} alt="Profile" className={styles.settingsAvatar} />
                <div className={styles.settingsAvatarEdit}>✏️</div>
              </div>
              <div>
                <div className={styles.settingsUserName}>{userName}</div>
                <div className={styles.settingsUserEmail}>{userEmail}</div>
                <div className={styles.settingsPlanBadge}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  PRO PLAN
                </div>
              </div>
            </div>

            <Link to="/child/panel" className={styles.childPanelLink}>
              <div>
                <div className={styles.childPanelLinkText}>View Child Panel</div>
                <div className={styles.childPanelLinkSub}>Switch to child view</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#29B6F6" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
            </Link>

            <div className={styles.settingsGroups}>

              {/* NOTIFICATIONS */}
              <div className={`${styles.settingsGroup} ${styles.reveal}`}>
                <div className={styles.settingsGroupHeader}>Notifications</div>
                {[
                  { icon: '🚨', bg: 'rgba(255,82,82,0.15)', label: 'SOS Alerts' },
                  { icon: '🏠', bg: 'rgba(255,179,0,0.15)', label: 'Geofence exits' },
                  { icon: '🔋', bg: 'rgba(255,179,0,0.15)', label: 'Battery low' },
                  { icon: '📍', bg: 'rgba(0,230,118,0.15)', label: 'Arrival alerts' },
                ].map((row) => (
                  <div key={row.label} className={styles.settingsRow}>
                    <div className={styles.settingsRowLeft}>
                      <div className={styles.settingsRowIcon} style={{ background: row.bg }}>{row.icon}</div>
                      <div className={styles.settingsRowLabel}>{row.label}</div>
                    </div>
                    <label className={styles.toggleSwitch}>
                      <input type="checkbox" defaultChecked />
                      <span className={styles.toggleSlider}></span>
                    </label>
                  </div>
                ))}
              </div>

              {/* PRIVACY */}
              <div className={`${styles.settingsGroup} ${styles.reveal}`} style={{ transitionDelay: '0.06s' }}>
                <div className={styles.settingsGroupHeader}>Privacy</div>
                <div className={styles.settingsRow}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(41,182,246,0.15)' }}>🔒</div>
                    <div className={styles.settingsRowLabel}>Share my location</div>
                  </div>
                  <label className={styles.toggleSwitch}>
                    <input type="checkbox" defaultChecked />
                    <span className={styles.toggleSlider}></span>
                  </label>
                </div>
                <div className={styles.settingsRow} style={{ cursor: 'default' }}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(171,71,188,0.15)' }}>🎯</div>
                    <div className={styles.settingsRowLabel}>Location precision</div>
                  </div>
                  <div className={styles.segmentedControl}>
                    <button className={`${styles.segBtn} ${segmentVal === 'Exact' ? styles.segBtnActive : ''}`} onClick={() => setSegmentVal('Exact')}>Exact</button>
                    <button className={`${styles.segBtn} ${segmentVal === 'Approx' ? styles.segBtnActive : ''}`} onClick={() => setSegmentVal('Approx')}>Approx</button>
                  </div>
                </div>
              </div>

              {/* FAMILY */}
              <div className={`${styles.settingsGroup} ${styles.reveal}`} style={{ transitionDelay: '0.12s' }}>
                <div className={styles.settingsGroupHeader}>Family</div>
                <div className={styles.settingsRow}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(0,230,118,0.15)' }}>👨‍👩‍👧‍👦</div>
                    <div className={styles.settingsRowLabel}>Manage Family Circle</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
                <div className={styles.settingsRow}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(0,230,118,0.15)' }}>➕</div>
                    <div className={styles.settingsRowLabel}>Invite Member</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#00E676', background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.2)', padding: '3px 10px', borderRadius: 10 }}>Invite</div>
                </div>
              </div>

              {/* APP */}
              <div className={`${styles.settingsGroup} ${styles.reveal}`} style={{ transitionDelay: '0.18s' }}>
                <div className={styles.settingsGroupHeader}>App</div>
                <div className={styles.settingsRow} style={{ cursor: 'default' }}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(5,12,8,0.5)' }}>🌙</div>
                    <div className={styles.settingsRowLabel}>Dark theme</div>
                  </div>
                  <label className={styles.toggleSwitch}>
                    <input type="checkbox" defaultChecked />
                    <span className={styles.toggleSlider}></span>
                  </label>
                </div>
                <div className={styles.settingsRow} style={{ cursor: 'default' }}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(41,182,246,0.15)' }}>🌐</div>
                    <div className={styles.settingsRowLabel}>Language</div>
                  </div>
                  <div className={styles.settingsRowValue}>English</div>
                </div>
                <div className={styles.settingsRow}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(0,230,118,0.15)' }}>ℹ️</div>
                    <div className={styles.settingsRowLabel}>About Gravity</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={styles.settingsRowValue}>v2.4.1</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>
              </div>

              {/* DANGER ZONE */}
              <div className={`${styles.settingsGroup} ${styles.settingsDangerGroup} ${styles.reveal}`} style={{ transitionDelay: '0.24s' }}>
                <div className={styles.settingsGroupHeader} style={{ color: '#FF5252' }}>Danger Zone</div>
                <div className={`${styles.settingsRow} ${styles.settingsDangerRow}`} onClick={doLogout}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(255,82,82,0.15)' }}>🚪</div>
                    <div>
                      <div className={styles.settingsRowLabel}>Logout</div>
                      <div style={{ fontSize: 11, color: '#5E8B6E' }}>Sign out of Gravity</div>
                    </div>
                  </div>
                </div>
                <div className={`${styles.settingsRow} ${styles.settingsDangerRow}`} onClick={confirmLeave}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(255,82,82,0.15)' }}>🚪</div>
                    <div className={styles.settingsRowLabel}>Leave Family Circle</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
                <div className={`${styles.settingsRow} ${styles.settingsDangerRow}`} onClick={confirmDelete}>
                  <div className={styles.settingsRowLeft}>
                    <div className={styles.settingsRowIcon} style={{ background: 'rgba(255,82,82,0.15)' }}>🗑️</div>
                    <div className={styles.settingsRowLabel}>Delete Account</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              </div>

              <div style={{ height: 16 }}></div>
            </div>
          </div>

        </div>

        {/* BOTTOM NAV */}
        <nav className={styles.bottomNav}>
          {([
            { key: 'map', label: 'Map', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
            { key: 'family', label: 'Family', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
            { key: 'alerts', label: 'Alerts', badge: notifCount, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> },
            { key: 'geofence', label: 'Geofence', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
            { key: 'settings', label: 'Settings', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5E8B6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
          ] as { key: string; label: string; icon: React.ReactNode; badge?: number }[]).map((tab) => (
            <button
              key={tab.key}
              className={`${styles.navTab} ${activeTab === tab.key ? styles.navTabActive : ''}`}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
            >
              <div className={styles.navTabIcon} style={{ position: 'relative' }}>
                {tab.icon}
                {tab.badge && tab.badge > 0 ? <div className={styles.navTabBadge}>{tab.badge}</div> : null}
              </div>
              <span className={styles.navTabLabel}>{tab.label}</span>
            </button>
          ))}
        </nav>

      </div>
    </div>
  )
}
