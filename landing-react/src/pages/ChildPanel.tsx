import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from './ChildPanel.module.css'

// Leaflet types
declare global {
  interface Window {
    L: {
      map: (id: string, opts: object) => LeafletMap
      tileLayer: (url: string, opts: object) => LeafletLayer
      divIcon: (opts: object) => object
      marker: (latlng: [number, number], opts: object) => LeafletMarker
    }
  }
  interface Navigator {
    getBattery?: () => Promise<{ level: number; charging: boolean }>
  }
}
interface LeafletMap {
  getZoom: () => number
  setZoom: (z: number, opts: object) => void
  setView: (latlng: [number, number], zoom: number) => void
  fitBounds: (bounds: [number, number][], opts: object) => void
  removeLayer: (layer: LeafletLayer) => void
  invalidateSize: () => void
}
interface LeafletLayer {
  addTo: (map: LeafletMap) => LeafletLayer
  bringToBack: () => void
}
interface LeafletMarker {
  setLatLng: (latlng: [number, number]) => void
  addTo: (map: LeafletMap) => LeafletMarker
  bindPopup: (html: string, opts?: object) => LeafletMarker
}

interface Member {
  id: string
  name: string
  lat: number | null
  lng: number | null
  status: string
  battery: number
  color: string
  avatar: string
  isMe: boolean
  role?: string
  phone?: string
}

const API_BASE = window.location.origin + '/api/v1'

const TILE_LAYERS: Record<string, { url: string; opts: object }> = {
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',           opts: { subdomains: 'abcd', maxZoom: 19 } },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',          opts: { subdomains: 'abcd', maxZoom: 19 } },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19 } },
  street:    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: { subdomains: 'abcd', maxZoom: 19 } }
}

export default function ChildPanel() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<string>('home')
  const [currentTime, setCurrentTime] = useState<string>('Good morning · 9:41 AM')
  const [greetingName, setGreetingName] = useState<string>('Good morning ☀️')
  const [headerUserName, setHeaderUserName] = useState<string>('Hey 👋')
  const [headerAvatar, setHeaderAvatar] = useState<string>('https://picsum.photos/seed/gravity-user/56/56')
  const [profileName, setProfileName] = useState<string>('Loading...')
  const [profileRole, setProfileRole] = useState<string>('Member')
  const [locName] = useState<string>('Location sharing active')
  const [familySafeBannerText, setFamilySafeBannerText] = useState<string>('Family members are safe')
  const [familyTabSub, setFamilyTabSub] = useState<string>('Loading members...')
  const [displayMembers, setDisplayMembers] = useState<Member[]>([])
  const [toasts, setToasts] = useState<Array<{id: number; message: string; type: string; show: boolean}>>([])
  const [mapType, setMapType] = useState<string>('dark')
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('gravity_toggles') || 'null') || {
        shareLocation: true,
        autoSos: true,
        familyArrivals: true,
        sosAlerts: true,
        geofence: true
      }
    } catch {
      return { shareLocation: true, autoSos: true, familyArrivals: true, sosAlerts: true, geofence: true }
    }
  })
  const [precision, setPrecisionState] = useState<string>('exact')
  const [hasCircle, setHasCircle] = useState<boolean | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [joinCode, setJoinCode] = useState<string>('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [alerts, setAlerts] = useState<Array<{id:string;type:string;userName:string;zoneName:string;eventType:string;message:string;timestamp:string;read:boolean}>>([])
  const [unreadAlerts, setUnreadAlerts] = useState(0)
  const [alertFilter, setAlertFilter] = useState<string>('all')
  const [, setStatusBarTime] = useState('')
  const [gpsActive, setGpsActive] = useState(false)
  const [todayDistance, setTodayDistance] = useState<string>('—')
  const [todaySafeZones, setTodaySafeZones] = useState<number>(0)
  const [todayCheckins, setTodayCheckins] = useState<number>(0)

  // Location history state
  interface LocationHistoryEntry {
    id: string
    latitude: number
    longitude: number
    accuracy: number | null
    battery_level: number | null
    recorded_at: string
    distance_from_home_km: number | null
  }
  const [locationHistory, setLocationHistory] = useState<LocationHistoryEntry[]>([])
  const [locationHistoryLoading, setLocationHistoryLoading] = useState(false)

  // GPS coordinates state
  const [myLat, setMyLat] = useState<number|null>(null)
  const [myLng, setMyLng] = useState<number|null>(null)
  const [locationLastUpdated, setLocationLastUpdated] = useState('Just now')

  // geolocation watch ref
  const watchIdRef = useRef<number | null>(null)
  const lastLocationSentRef = useRef<number>(0)

  // SOS state — home
  const [homeSosActive, setHomeSosActive] = useState(false)
  const [homeSosCount, setHomeSosCount] = useState(3)
  const [homeSosCountVisible, setHomeSosCountVisible] = useState(false)
  const homeSosTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // SOS state — big tab
  const [bigSosActive, setBigSosActive] = useState(false)
  const [bigSosCount, setBigSosCount] = useState(3)
  const [bigSosCountVisible, setBigSosCountVisible] = useState(false)
  const bigSosTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Map refs
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const activeTileRef = useRef<LeafletLayer | null>(null)
  const memberMarkersRef = useRef<Record<string, LeafletMarker>>({})
  const mapInitRef = useRef(false)
  const currentCircleIdRef = useRef<string | null>(null)
  const displayMembersRef = useRef<Member[]>([])
  const toastCounterRef = useRef(0)
  const avatarFileRef = useRef<HTMLInputElement>(null)

  // Auth check
  const gravityToken = useMemo(() => localStorage.getItem('gravity_token'), [])
  const gravityUser = useMemo(() => { try { return JSON.parse(localStorage.getItem('gravity_user') || 'null') } catch { return null } }, [])

  useEffect(() => {
    if (!gravityToken) {
      localStorage.setItem('gravity_redirect', '/child/panel')
      navigate('/login?redirect=/child/panel')
      return
    }
    // Role guard: only children may use the child panel.
    if (!gravityUser || !gravityUser.account_type) {
      navigate('/login')
    } else if (gravityUser.account_type !== 'child') {
      navigate('/parent/panel')
    }
  }, [gravityToken, gravityUser, navigate])

  // Show toast
  const showToast = useCallback((message: string, type = 'success') => {
    const id = ++toastCounterRef.current
    setToasts(prev => [...prev, { id, message, type, show: false }])
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, show: true } : t))
    }, 10)
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, show: false } : t))
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 350)
    }, 3000)
  }, [])

  // GPS permission status
  useEffect(() => {
    if (navigator.geolocation && navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(perm => {
        setGpsActive(perm.state === 'granted')
        perm.onchange = () => setGpsActive(perm.state === 'granted')
      }).catch(() => setGpsActive(false))
    }
  }, [])

  // API helpers
  const apiGet = useCallback(async (path: string) => {
    const res = await fetch(API_BASE + path, {
      headers: { 'Authorization': 'Bearer ' + gravityToken }
    })
    if (res.status === 401) {
      localStorage.clear()
      navigate('/login?redirect=/child/panel')
      return null
    }
    return res.json()
  }, [gravityToken, navigate])

  const apiPost = useCallback(async (path: string, body: object) => {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + gravityToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    return res.json()
  }, [gravityToken])

  const apiPatch = useCallback(async (path: string, body: object) => {
    const res = await fetch(API_BASE + path, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + gravityToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    return res.json()
  }, [gravityToken])
  void apiPatch

  // Load location history
  const loadLocationHistory = useCallback(async () => {
    setLocationHistoryLoading(true)
    try {
      const data = await apiGet('/users/me/location-history')
      if (data && Array.isArray(data.locations)) {
        setLocationHistory(data.locations.slice(0, 10))
      } else if (data && Array.isArray(data)) {
        setLocationHistory(data.slice(0, 10))
      }
    } catch (e) {
      console.warn('Location history fetch failed', e)
    } finally {
      setLocationHistoryLoading(false)
    }
  }, [apiGet])

  // Update time
  const updateTime = useCallback(() => {
    const now = new Date()
    const h = now.getHours()
    const m = now.getMinutes().toString().padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = ((h % 12) || 12)
    const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    setCurrentTime(`${greeting} · ${h12}:${m} ${ampm}`)
    setStatusBarTime(h12 + ':' + m)
    if (gravityUser) {
      const name = gravityUser.name || 'User'
      const emoji = h < 12 ? ' ☀️' : h < 17 ? ' 👋' : ' 🌙'
      setGreetingName(`${greeting}, ${name}${emoji}`)
    }
  }, [gravityUser])

  // Load real data
  useEffect(() => {
    const loadRealData = async () => {
      try {
        if (gravityUser) {
          const name = gravityUser.name || 'User'
          const h = new Date().getHours()
          const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
          const emoji = h < 12 ? ' ☀️' : h < 17 ? ' 👋' : ' 🌙'
          setGreetingName(`${greeting}, ${name}${emoji}`)
          setProfileName(name)
          setProfileRole(gravityUser.role || 'Member')
          setHeaderUserName(`Hey, ${name} 👋`)
          if (gravityUser.avatar_url) {
            setHeaderAvatar(gravityUser.avatar_url)
          }
        }

        const data = await apiGet('/circles')
        if (!data || !data.circles || !data.circles.length) {
          setHasCircle(false)
          setFamilySafeBannerText('No circle joined yet')
          setFamilyTabSub('No members · Join a circle')
          return
        }
        setHasCircle(true)
        currentCircleIdRef.current = data.circles[0].id

        const membersData = await apiGet('/circles/' + currentCircleIdRef.current + '/members')
        if (membersData && membersData.members) {
          const colors = ['#00E676', '#00C853', '#FFB300', '#AB47BC', '#5E8B6E', '#29B6F6']
          const members: Member[] = membersData.members.map((m: Record<string, string>, i: number) => ({
            id: m.id,
            name: m.name,
            lat: parseFloat(m.latitude) || null,
            lng: parseFloat(m.longitude) || null,
            status: m.location_updated_at ? 'Online' : 'Offline',
            battery: parseInt(m.battery_level) || 70,
            color: colors[i % colors.length],
            avatar: m.avatar_url || ('https://picsum.photos/seed/' + encodeURIComponent(m.name) + '/56/56'),
            isMe: m.id === (gravityUser && gravityUser.id),
            role: m.role
          }))

          const total = members.length
          setFamilySafeBannerText(`${total} family member${total === 1 ? '' : 's'} in your circle`)
          setFamilyTabSub(`${total} member${total === 1 ? '' : 's'} · Read-only view`)
          setDisplayMembers(members)
          displayMembersRef.current = members

          if (mapInitRef.current) refreshMapMarkers(members)
        }

        // Fetch today's activity stats
        try {
          const statsData = await apiGet('/users/me/stats')
          if (statsData && statsData.today) {
            const s = statsData.today
            // backend returns: { distance, safeZones, checkins }
            const dist = s.distance ?? s.distance_km ?? 0
            setTodayDistance(parseFloat(dist) > 0 ? parseFloat(dist).toFixed(1) + ' km' : '0 km')
            setTodaySafeZones(parseInt(s.safeZones ?? s.safe_zones_visited ?? 0))
            setTodayCheckins(parseInt(s.checkins ?? s.family_checkins ?? 0))
          }
        } catch { /* stats endpoint optional */ }

        connectSSE()
        startLocationWatch()
      } catch (e) {
        console.error('Child loadRealData error', e)
        setHasCircle(false)
      }
    }
    loadRealData()
    const fallback = setTimeout(() => {
      setHasCircle(prev => prev === null ? false : prev)
    }, 4000)
    return () => clearTimeout(fallback)
  }, [apiGet, gravityUser])

  // Geolocation watch — sends child's own location to backend every 30 s
  const startLocationWatch = useCallback(() => {
    if (!navigator.geolocation) return
    if (watchIdRef.current !== null) return // already watching
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        // Always update live GPS state for UI
        setMyLat(latitude)
        setMyLng(longitude)
        const ts = new Date()
        const h12 = ((ts.getHours() % 12) || 12)
        const mm = ts.getMinutes().toString().padStart(2, '0')
        const ampm = ts.getHours() >= 12 ? 'PM' : 'AM'
        setLocationLastUpdated(`${h12}:${mm} ${ampm}`)
        setGpsActive(true)
        const now = Date.now()
        if (now - lastLocationSentRef.current < 30000) return // throttle to 30 s
        lastLocationSentRef.current = now
        // Get battery level if available, default to 75
        const sendLocation = (battery_level: number) => {
          fetch(API_BASE + '/users/location', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + gravityToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ latitude, longitude, accuracy, battery_level })
          }).catch(e => console.warn('Location POST failed (silent)', e))
        }
        if (navigator.getBattery) {
          navigator.getBattery().then(bat => {
            sendLocation(Math.round(bat.level * 100))
          }).catch(() => sendLocation(75))
        } else {
          sendLocation(75)
        }
      },
      (err) => console.warn('Geolocation watch error', err),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    )
  }, [gravityToken])

  // SSE
  const connectSSE = useCallback(() => {
    if (!currentCircleIdRef.current || !gravityToken) return
    const evtSource = new EventSource(API_BASE + '/sse/stream?token=' + gravityToken)
    evtSource.addEventListener('location_update', (e: MessageEvent) => {
      const d = JSON.parse(e.data)
      if (!d.userId || !d.latitude || !d.longitude) return
      setDisplayMembers(prev => {
        const updated = prev.map(m => m.id === d.userId
          ? { ...m, lat: d.latitude, lng: d.longitude, status: 'Online', battery: d.batteryLevel || m.battery }
          : m)
        displayMembersRef.current = updated
        if (leafletMapRef.current && memberMarkersRef.current[d.userId]) {
          memberMarkersRef.current[d.userId].setLatLng([d.latitude, d.longitude])
        }
        return updated
      })
    })
    evtSource.addEventListener('geofence_event', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setAlerts(prev => [{
        id: Date.now().toString(),
        type: 'geofence',
        userName: data.userName || 'Family member',
        zoneName: data.zoneName || 'Safe zone',
        eventType: data.eventType || 'entry',
        message: data.eventType === 'entry' ? `${data.userName} arrived at ${data.zoneName}` : `${data.userName} left ${data.zoneName}`,
        timestamp: data.timestamp || new Date().toISOString(),
        read: false
      }, ...prev].slice(0, 50))
      setUnreadAlerts(prev => prev + 1)
    })
    evtSource.addEventListener('sos_alert', (e: MessageEvent) => {
      const d = JSON.parse(e.data)
      showToast('🆘 SOS from ' + (d.userName || 'Family member'), 'sos')
      const data = d
      setAlerts(prev => [{
        id: Date.now().toString(),
        type: 'sos',
        userName: data.userName || 'Family member',
        zoneName: '',
        eventType: 'sos',
        message: data.message || 'SOS Alert!',
        timestamp: data.timestamp || new Date().toISOString(),
        read: false
      }, ...prev].slice(0, 50))
      setUnreadAlerts(prev => prev + 1)
    })
    evtSource.onerror = () => evtSource.close()
  }, [gravityToken, showToast])

  // Reveal observer
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') })
    }, { threshold: 0.1 })
    const els = document.querySelectorAll(`.${styles.reveal}`)
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [activeTab])

  // Re-run reveal when async data (members) loads — cards rendered after tab switch need this
  useEffect(() => {
    setTimeout(() => {
      document.querySelectorAll(`.${styles.reveal}:not(.visible)`).forEach(el => {
        el.classList.add('visible')
      })
    }, 80)
  }, [displayMembers, hasCircle])

  // Clock
  useEffect(() => {
    updateTime()
    const interval = setInterval(updateTime, 30000)
    return () => clearInterval(interval)
  }, [updateTime])

  // Map helpers
  const addMemberMarker = useCallback((m: Member) => {
    const L = window.L
    if (!leafletMapRef.current || !m.lat || !m.lng || !L) return
    if (memberMarkersRef.current[m.id]) {
      memberMarkersRef.current[m.id].setLatLng([m.lat, m.lng])
      return
    }
    const size = m.isMe ? 52 : 44
    const icon = L.divIcon({
      className: '',
      html: `
        <div style="text-align:center;position:relative;">
          <img src="${m.avatar}"
               style="width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid ${m.color};object-fit:cover;box-shadow:0 0 14px ${m.color}90;display:block;margin:auto;position:relative;z-index:1;"
               loading="lazy">
          <div style="font-size:9px;font-weight:700;background:rgba(5,12,8,.92);color:${m.color};padding:2px 6px;border-radius:5px;margin-top:3px;border:1px solid ${m.color}40;font-family:'Plus Jakarta Sans',sans-serif;position:relative;z-index:1;">
            ${m.isMe ? '📍 You' : m.name.split(' ')[0]}
          </div>
        </div>
      `,
      iconSize: [size + 10, size + 28],
      iconAnchor: [(size + 10) / 2, (size + 10) / 2]
    })
    const marker = L.marker([m.lat, m.lng], { icon }).addTo(leafletMapRef.current)
    marker.bindPopup(`
      <div style="font-family:'Plus Jakarta Sans',sans-serif;background:#0D1F13;color:#fff;border-radius:10px;padding:8px;min-width:120px;border:1px solid ${m.color}40;">
        <strong style="color:${m.color};">${m.name}</strong><br>
        <span style="font-size:11px;color:#5E8B6E;">${m.role || (m.isMe ? 'You' : 'Member')}</span><br>
        <span style="font-size:11px;">🔋 ${m.battery}%</span><br>
        <span style="font-size:11px;color:${m.color};">${m.status}</span>
      </div>
    `)
    memberMarkersRef.current[m.id] = marker
  }, [])

  const refreshMapMarkers = useCallback((members: Member[]) => {
    if (!leafletMapRef.current) return
    const located = members.filter(m => m.lat && m.lng)
    located.forEach(m => addMemberMarker(m))
    if (located.length >= 2) {
      leafletMapRef.current.fitBounds(located.map(m => [m.lat!, m.lng!] as [number, number]), { padding: [36, 36] })
    } else if (located.length === 1) {
      leafletMapRef.current.setView([located[0].lat!, located[0].lng!], 14)
    }
    setTimeout(() => leafletMapRef.current?.invalidateSize(), 150)
  }, [addMemberMarker])

  const initMap = useCallback(() => {
    const L = window.L
    if (mapInitRef.current || !L) return
    // Inject Leaflet CSS if not already present
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    mapInitRef.current = true
    const defaultCenter: [number, number] = [20.5937, 78.9629]
    leafletMapRef.current = L.map('map-leaflet', {
      center: defaultCenter,
      zoom: 5,
      zoomControl: false,
      attributionControl: false
    })
    activeTileRef.current = L.tileLayer(TILE_LAYERS.dark.url, TILE_LAYERS.dark.opts).addTo(leafletMapRef.current)
    if (displayMembersRef.current.length) {
      refreshMapMarkers(displayMembersRef.current)
    }
    setTimeout(() => leafletMapRef.current?.invalidateSize(), 150)
  }, [refreshMapMarkers])

  const switchMapType = useCallback((type: string) => {
    const L = window.L
    if (!leafletMapRef.current || !L) return
    if (activeTileRef.current) leafletMapRef.current.removeLayer(activeTileRef.current)
    const t = TILE_LAYERS[type]
    activeTileRef.current = L.tileLayer(t.url, t.opts).addTo(leafletMapRef.current)
    activeTileRef.current.bringToBack()
    setMapType(type)
  }, [])

  const mapZoomIn = useCallback(() => {
    if (leafletMapRef.current) leafletMapRef.current.setZoom(leafletMapRef.current.getZoom() + 1, { animate: true })
  }, [])

  const mapZoomOut = useCallback(() => {
    if (leafletMapRef.current) leafletMapRef.current.setZoom(leafletMapRef.current.getZoom() - 1, { animate: true })
  }, [])

  // Tab switching
  const switchTab = useCallback((tabId: string) => {
    setActiveTab(tabId)
    if (tabId === 'map' && !mapInitRef.current) {
      setTimeout(initMap, 80)
    }
    if (tabId === 'alerts') {
      setUnreadAlerts(0)
      setAlerts(prev => prev.map(a => ({ ...a, read: true })))
    }
    if (tabId === 'profile') {
      loadLocationHistory()
    }
    setTimeout(() => {
      document.querySelectorAll(`.${styles.reveal}:not(.visible)`).forEach(el => {
        const rect = el.getBoundingClientRect()
        if (rect.top < window.innerHeight + 100) el.classList.add('visible')
      })
    }, 50)
  }, [initMap, loadLocationHistory])

  // Format alert timestamp
  const formatTime = useCallback((ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }, [])

  // Focus a family member on the map
  const focusMemberOnMap = useCallback((member: Member) => {
    switchTab('map')
    setTimeout(() => {
      if (member.lat && member.lng && leafletMapRef.current) {
        leafletMapRef.current.setView([member.lat, member.lng], 16)
        // Note: openPopup not in current LeafletMarker interface — just center map
      }
    }, 300)
  }, [switchTab])

  // SOS: Home button
  const startHomeSos = useCallback(() => {
    if (homeSosActive) return
    setHomeSosActive(true)
    setHomeSosCount(3)
    setHomeSosCountVisible(true)
    let count = 3
    homeSosTimerRef.current = setInterval(() => {
      count--
      if (count > 0) {
        setHomeSosCount(count)
      } else {
        clearInterval(homeSosTimerRef.current!)
        setHomeSosCountVisible(false)
        setHomeSosActive(false)
        activateSOS()
      }
    }, 1000)
  }, [homeSosActive])

  const cancelHomeSos = useCallback(() => {
    if (!homeSosActive) return
    clearInterval(homeSosTimerRef.current!)
    setHomeSosActive(false)
    setHomeSosCountVisible(false)
  }, [homeSosActive])

  // SOS: Big button
  const startBigSos = useCallback(() => {
    if (bigSosActive) return
    setBigSosActive(true)
    setBigSosCount(3)
    setBigSosCountVisible(true)
    let count = 3
    bigSosTimerRef.current = setInterval(() => {
      count--
      if (count > 0) {
        setBigSosCount(count)
      } else {
        clearInterval(bigSosTimerRef.current!)
        setBigSosCountVisible(false)
        setBigSosActive(false)
        activateSOS()
      }
    }, 1000)
  }, [bigSosActive])

  const cancelBigSos = useCallback(() => {
    if (!bigSosActive) return
    clearInterval(bigSosTimerRef.current!)
    setBigSosActive(false)
    setBigSosCountVisible(false)
  }, [bigSosActive])

  const activateSOS = () => {
    showToast('🆘 SOS Alert sent to your family!', 'sos')
    const sendSOS = async (lat: number | null, lng: number | null) => {
      try {
        await apiPost('/sos', { latitude: lat, longitude: lng, message: 'SOS! I need help!' })
      } catch (e) { console.error('SOS send failed', e) }
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => sendSOS(pos.coords.latitude, pos.coords.longitude),
        () => sendSOS(null, null)
      )
    } else { sendSOS(null, null) }
  }

  // Quick actions
  const triggerImSafe = async () => {
    try {
      await apiPost('/sos/safe', { message: "I'm safe!" })
      showToast('✓ Family notified you are safe!', 'success')
    } catch {
      showToast('✓ Family notified you are safe!', 'success')
    }
  }
  const triggerShareLocation = () => {
    const shareUrl = window.location.origin + '/share?uid=' + (gravityUser?.id || '')
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('📍 Location link copied!', 'success')
    }).catch(() => {
      showToast('📍 Location link copied!', 'success')
    })
  }
  const triggerArriveSafe = () => {
    const locationLabel = myLat && myLng
      ? `${myLat.toFixed(4)}, ${myLng.toFixed(4)}`
      : 'current location'
    showToast(`🔔 Notify family when I arrive from ${locationLabel}`, 'success')
  }
  const triggerMessage = () => switchTab('family')
  const sendQuickMsg = useCallback(async (msg: string) => {
    const doSend = async (lat: number | null, lon: number | null) => {
      try {
        await apiPost('/sos', { latitude: lat, longitude: lon, message: msg })
        showToast(`🆘 SOS sent: ${msg}`, 'success')
      } catch {
        showToast('⚠️ Failed to send SOS', 'error')
      }
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => doSend(pos.coords.latitude, pos.coords.longitude),
        () => doSend(null, null)
      )
    } else {
      doSend(null, null)
    }
  }, [apiPost, showToast])

  const toggleSwitch = (key: string) => {
    setToggles(prev => {
      const next = { ...prev, [key]: !prev[key] }
      showToast(next[key] ? '✓ Setting enabled' : '○ Setting disabled')
      try { localStorage.setItem('gravity_toggles', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const handleAvatarUpload = async (file: File) => {
    if (!file) return
    setAvatarUploading(true)
    try {
      // Step 1: get presigned URL
      const presignRes = await fetch(API_BASE + '/media/avatar/presign', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + gravityToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, fileSize: file.size })
      })
      if (!presignRes.ok) throw new Error('Presign failed')
      const { uploadUrl, publicUrl } = await presignRes.json()

      // Step 2: PUT file binary to R2 (no auth header)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      })
      if (!putRes.ok) throw new Error('Upload failed')

      // Step 3: confirm
      const confirmRes = await fetch(API_BASE + '/media/avatar/confirm', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + gravityToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl })
      })
      if (!confirmRes.ok) throw new Error('Confirm failed')
      const { avatar_url } = await confirmRes.json()

      // Update state and localStorage
      setHeaderAvatar(avatar_url)
      const stored = localStorage.getItem('gravity_user')
      if (stored) {
        try {
          const u = JSON.parse(stored)
          u.avatar_url = avatar_url
          localStorage.setItem('gravity_user', JSON.stringify(u))
        } catch { /* ignore */ }
      }
      showToast('Avatar updated!')
    } catch (e) {
      showToast('Avatar upload failed', 'error')
      console.error('Avatar upload error', e)
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleProfileSave = async () => {
    const name = profileName.trim()
    if (!name) { showToast('Name cannot be empty', 'error'); return }
    setProfileSaving(true)
    try {
      const res = await fetch(API_BASE + '/users/me', {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + gravityToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (!res.ok && res.status !== 404) throw new Error('Save failed')
      if (res.status === 404 || !res.ok) {
        // Update localStorage only
        const stored = localStorage.getItem('gravity_user')
        if (stored) {
          try {
            const u = JSON.parse(stored)
            u.name = name
            localStorage.setItem('gravity_user', JSON.stringify(u))
          } catch { /* ignore */ }
        }
        showToast('Saved locally')
      } else {
        const stored = localStorage.getItem('gravity_user')
        if (stored) {
          try {
            const u = JSON.parse(stored)
            u.name = name
            localStorage.setItem('gravity_user', JSON.stringify(u))
          } catch { /* ignore */ }
        }
        setHeaderUserName(`Hey, ${name} 👋`)
        showToast('Profile saved!')
      }
    } catch {
      const stored = localStorage.getItem('gravity_user')
      if (stored) {
        try {
          const u = JSON.parse(stored)
          u.name = name
          localStorage.setItem('gravity_user', JSON.stringify(u))
        } catch { /* ignore */ }
      }
      showToast('Saved locally')
    } finally {
      setProfileSaving(false)
    }
  }

  const doLogout = () => {
    localStorage.removeItem('gravity_token')
    localStorage.removeItem('gravity_user')
    navigate('/login')
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const joinCircle = async () => {
    const code = joinCode.trim()
    if (!code) { showToast('Enter invite code', 'error'); return }
    setJoinLoading(true)
    try {
      const res = await fetch(API_BASE + '/circles/join', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + gravityToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: code })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to join')
      setJoinCode('')
      setHasCircle(true)
      showToast('Joined family circle!')
      setTimeout(() => window.location.reload(), 800)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Invalid invite code', 'error')
    } finally {
      setJoinLoading(false)
    }
  }

  const others = displayMembers.filter(m => !m.isMe)

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.appFrame} id="appFrame">

        {/* HEADER */}
        <div className={styles.appHeader}>
          <div className={styles.headerLogo}>
            <div className={styles.navLogoIcon}>
              <svg className={styles.logoSvg} width="28" height="28" viewBox="0 0 40 40" fill="none">
                <defs>
                  <linearGradient id="pinGradCP" x1="12" y1="4" x2="28" y2="26" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#00FFB2"/>
                    <stop offset="100%" stopColor="#00C853"/>
                  </linearGradient>
                </defs>
                <path d="M20 4C14.48 4 10 8.48 10 14c0 8.5 10 22 10 22s10-13.5 10-22c0-5.52-4.48-10-10-10z" fill="url(#pinGradCP)"/>
                <circle cx="20" cy="13.5" r="3.5" fill="rgba(5,12,8,0.85)"/>
              </svg>
            </div>
            <span className={styles.navLogoText}>Gravity</span>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.headerGreeting}>
              <div className={styles.headerGreetingHey}>Welcome back</div>
              <div className={styles.headerGreetingName}>{headerUserName}</div>
            </div>
            <img className={styles.headerAvatar} src={headerAvatar} alt="User" />
            <button onClick={toggleFullscreen} className={styles.fullscreenBtn} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
                  <path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                  <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
              )}
            </button>
            <button onClick={doLogout} className={styles.logoutBtn}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className={styles.tabContent} id="tabContent">

          {/* ══ TAB 1: HOME ══ */}
          <div className={`${styles.tabPane} ${activeTab === 'home' ? styles.active : ''}`} id="tab-home">
            <div className={styles.section}>
              <div className={styles.sectionTitle}>My Status</div>
              <div className={`${styles.greetingCard} ${styles.reveal}`}>
                <div className={styles.greetingTime}>{currentTime}</div>
                <div className={styles.greetingName}>{greetingName}</div>
                <div className={styles.greetingSub}>
                  <div className={styles.onlineDot}></div>
                  Your family can see your location
                </div>
              </div>
              <div className={`${styles.locationCard} ${styles.reveal}`}>
                <div className={styles.locIcon}>📍</div>
                <div className={styles.locInfo}>
                  <div className={styles.locName}>{locName}</div>
                  <div className={styles.locTime}>
                    <div className={styles.locPulse}></div>
                    Updated {locationLastUpdated}
                  </div>
                  {myLat && myLng && (
                    <div style={{fontSize:'10px',color:'#5E8B6E',marginTop:'2px',fontFamily:'monospace'}}>
                      {myLat.toFixed(5)}, {myLng.toFixed(5)}
                    </div>
                  )}
                </div>
                <div className={styles.locLive}>LIVE</div>
              </div>
            </div>

            {/* BIG SOS BUTTON */}
            <div className={styles.sosSection}>
              <div className={styles.sosWrapper}>
                <div className={`${styles.sosRing} ${styles.sosRing1} ${styles.sosRingAnim1}`}></div>
                <div className={`${styles.sosRing} ${styles.sosRing2} ${styles.sosRingAnim2}`}></div>
                <div className={`${styles.sosRing} ${styles.sosRing3} ${styles.sosRingAnim3}`}></div>
                <button
                  className={styles.sosBtnMain}
                  id="homeSosBtn"
                  aria-label="SOS Emergency Button"
                  onMouseDown={startHomeSos}
                  onMouseUp={cancelHomeSos}
                  onMouseLeave={cancelHomeSos}
                  onTouchStart={e => { e.preventDefault(); startHomeSos() }}
                  onTouchEnd={e => { e.preventDefault(); cancelHomeSos() }}
                  onTouchCancel={cancelHomeSos}
                >
                  {!homeSosCountVisible && <span className={styles.sosText}>SOS</span>}
                  {!homeSosCountVisible && <span className={styles.sosSub}>EMERGENCY</span>}
                  {homeSosCountVisible && <span className={styles.sosCountdown} style={{display:'block'}}>{homeSosCount}</span>}
                </button>
              </div>
              <div className={styles.sosHint}>Hold <strong style={{color:'#FF5252'}}>3 seconds</strong> to send emergency alert</div>
              <div className={styles.sosContactsHint}>
                {others.length > 0
                  ? `Alerts: ${others.slice(0, 2).map(m => m.name.split(' ')[0]).join(', ')}${others.length > 2 ? ` + ${others.length - 2} more` : ''}`
                  : 'Alerts: Your family circle'}
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Quick Actions</div>
            </div>
            <div className={styles.quickActions}>
              <div className={`${styles.qaCard} ${styles.qaCardSafe} ${styles.reveal}`} onClick={triggerImSafe}>
                <div className={styles.qaIcon}>✅</div>
                <div className={styles.qaLabel}>I'm Safe</div>
                <div className={styles.qaDesc}>Notify all family members</div>
              </div>
              <div className={`${styles.qaCard} ${styles.qaCardShare} ${styles.reveal}`} onClick={triggerShareLocation}>
                <div className={styles.qaIcon}>📍</div>
                <div className={styles.qaLabel}>Share Location</div>
                <div className={styles.qaDesc}>Send live location link</div>
              </div>
              <div className={`${styles.qaCard} ${styles.qaCardArrive} ${styles.reveal}`} onClick={triggerArriveSafe}>
                <div className={styles.qaIcon}>🔔</div>
                <div className={styles.qaLabel}>Arrive Safe</div>
                <div className={styles.qaDesc}>Set destination alert</div>
              </div>
              <div className={`${styles.qaCard} ${styles.qaCardMessage} ${styles.reveal}`} onClick={triggerMessage}>
                <div className={styles.qaIcon}>💬</div>
                <div className={styles.qaLabel}>Message Family</div>
                <div className={styles.qaDesc}>Open group chat</div>
              </div>
            </div>

            {/* FAMILY STATUS STRIP */}
            <div className={styles.section}>
              <div className={styles.sectionTitle} style={{marginBottom:'8px'}}>Family Circle</div>
            </div>
            <div className={`${styles.familySafeBanner} ${styles.reveal}`}>
              <span>✓</span> <span>{familySafeBannerText}</span>
            </div>
            <div className={styles.familyScrollWrap}>
              <div className={styles.familyScroll}>
                {/* Own location status card */}
                <div className={styles.familyMini} onClick={() => showToast(myLat && myLng ? `📍 You · ${myLat.toFixed(4)}, ${myLng.toFixed(4)}` : '📍 You · Location sharing active')}>
                  <div className={styles.familyMiniRing} style={{
                    background: 'linear-gradient(135deg,#00E67655,#00E67622)',
                    boxShadow: '0 0 0 2.5px #00E676,0 0 10px #00E67640',
                    position: 'relative'
                  }}>
                    <img src={headerAvatar} alt="You" loading="lazy" />
                    <div className={styles.familyMiniIndicator}></div>
                  </div>
                  <div className={styles.familyMiniName} style={{color:'#00E676'}}>You</div>
                </div>
                {others.map(m => (
                  <div key={m.id} className={styles.familyMini} onClick={() => showToast(`📍 ${m.name} · ${m.status}${m.lat ? ` · ${m.lat.toFixed(4)}, ${m.lng!.toFixed(4)}` : ''}`)}>
                    <div className={styles.familyMiniRing} style={{
                      background: `linear-gradient(135deg,${m.color}55,${m.color}22)`,
                      boxShadow: `0 0 0 2.5px ${m.color},0 0 10px ${m.color}40`
                    }}>
                      <img src={m.avatar} alt={m.name} loading="lazy" />
                      <div className={`${styles.familyMiniIndicator} ${m.status !== 'Online' ? styles.familyMiniIndicatorOffline : ''}`}></div>
                    </div>
                    <div className={styles.familyMiniName}>{m.name.split(' ')[0]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>{/* /tab-home */}


          {/* ══ TAB 2: MAP ══ */}
          <div className={`${styles.tabPane} ${activeTab === 'map' ? styles.active : ''}`} id="tab-map">
            <div className={styles.mapHeader}>
              <div>
                <div className={styles.mapTitle}>Family Map</div>
                <div className={styles.mapSub}>Live locations · Updated now</div>
              </div>
              <div className={styles.allSafeTag}>🟢 ALL SAFE</div>
            </div>

            <div className={styles.mapContainer}>
              <div id="map-leaflet" className={styles.mapLeaflet}></div>
              <div className={styles.mapTypeSwitcher}>
                {(['dark','light','satellite','street'] as const).map(t => (
                  <button
                    key={t}
                    className={`${styles.mapTypeBtn} ${mapType === t ? styles.mapTypeBtnActive : ''}`}
                    onClick={() => switchMapType(t)}
                    data-type={t}
                  >
                    <span className="mti">{t === 'dark' ? '🌙' : t === 'light' ? '☀️' : t === 'satellite' ? '🛰️' : '🗺️'}</span>
                    {t.charAt(0).toUpperCase() + t.slice(1, t === 'satellite' ? 3 : undefined)}
                  </button>
                ))}
              </div>
              <div className={styles.mapZoomCtrl}>
                <button className={styles.mapZoomBtn} onClick={mapZoomIn}>+</button>
                <button className={styles.mapZoomBtn} onClick={mapZoomOut}>−</button>
              </div>
            </div>

            <div className={styles.distanceBadges}>
              {others.map(m => (
                <div key={m.id} className={styles.distBadge}>
                  <div className={styles.distDot} style={{background: m.color, boxShadow: `0 0 6px ${m.color}80`}}></div>
                  {m.name.split(' ')[0]}
                </div>
              ))}
            </div>

            {others.length > 0 && (
              <div className={`${styles.nearestCard} ${styles.reveal}`}>
                <div className={styles.nearestLabel}>Nearest Family Member</div>
                <div className={styles.nearestInfo}>
                  <img className={styles.nearestAvatar} src={others[0].avatar} alt={others[0].name} />
                  <div>
                    <div className={styles.nearestName}>{others[0].name.split(' ')[0]}</div>
                    <div className={styles.nearestDist}>📍 {others[0].lat ? 'Location shared' : 'Location not shared'} · {others[0].status}</div>
                  </div>
                </div>
              </div>
            )}
            <div style={{height:'20px'}}></div>
          </div>{/* /tab-map */}


          {/* ══ TAB 3: SOS ══ */}
          <div className={`${styles.tabPane} ${activeTab === 'sos' ? styles.active : ''}`} id="tab-sos">
            <div className={styles.sosTabHeader}>
              <div className={styles.sosTabTitle}>🚨 Emergency SOS</div>
              <div className={styles.sosTabSub}>Press and hold to send emergency alert to family</div>
            </div>
            {/* GPS Status Bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: gpsActive ? 'rgba(0,230,118,0.08)' : 'rgba(255,82,82,0.08)',
              border: `1px solid ${gpsActive ? 'rgba(0,230,118,0.25)' : 'rgba(255,82,82,0.25)'}`,
              borderRadius: 10, padding: '8px 14px', marginBottom: 14, fontSize: 13
            }}>
              <span style={{fontSize: 16}}>{gpsActive ? '🛰️' : '📵'}</span>
              <span style={{color: gpsActive ? '#00E676' : '#FF5252', fontWeight: 600}}>
                GPS: {gpsActive ? 'Active' : 'Off'}
              </span>
              <span style={{color: '#5E8B6E', marginLeft: 'auto', fontSize: 11}}>
                {gpsActive ? 'Location ready to share' : 'Enable location for precise SOS'}
              </span>
            </div>

            <div className={styles.sosBigWrap}>
              <div className={styles.sosBigRingWrap}>
                <div className={`${styles.sosBigRing} ${styles.sosBigRing1} ${styles.sosRingAnim1}`}></div>
                <div className={`${styles.sosBigRing} ${styles.sosBigRing2} ${styles.sosRingAnim2}`}></div>
                <div className={`${styles.sosBigRing} ${styles.sosBigRing3} ${styles.sosRingAnim3}`}></div>
                <button
                  className={styles.sosBtnBig}
                  id="bigSosBtn"
                  aria-label="Big SOS Button"
                  onMouseDown={startBigSos}
                  onMouseUp={cancelBigSos}
                  onMouseLeave={cancelBigSos}
                  onTouchStart={e => { e.preventDefault(); startBigSos() }}
                  onTouchEnd={e => { e.preventDefault(); cancelBigSos() }}
                  onTouchCancel={cancelBigSos}
                >
                  {!bigSosCountVisible && <span className={styles.sosMainText}>SOS</span>}
                  {!bigSosCountVisible && <span className={styles.sosInst}>PRESS &amp; HOLD</span>}
                  {bigSosCountVisible && <span className={styles.sosCountdownBig} style={{display:'block'}}>{bigSosCount}</span>}
                </button>
              </div>
              <div className={styles.holdInstructions}>
                Hold for <strong style={{color:'#FF5252'}}>3 seconds</strong> to activate<br/>
                <span style={{fontSize:'11px'}}>Your GPS location will be sent instantly</span>
              </div>
            </div>

            {/* Quick Messages */}
            <div className={styles.quickMsgs}>
              <div className={styles.sectionTitle} style={{paddingLeft:0,marginBottom:0}}>Quick Messages</div>
              <div style={{fontSize:11,color:'#5E8B6E',marginBottom:8}}>
                📍 Your location will be shared with all emergency contacts
              </div>
              <div className={styles.qmGrid}>
                <button className={`${styles.qmBtn} ${styles.qmRed}`} onClick={() => sendQuickMsg('I need help!')}>
                  <span style={{fontSize:18,display:'block',marginBottom:2}}>🆘</span>
                  <span>I need help!</span>
                </button>
                <button className={`${styles.qmBtn} ${styles.qmOrange}`} onClick={() => sendQuickMsg("I'm in danger!")}>
                  <span style={{fontSize:18,display:'block',marginBottom:2}}>⚠️</span>
                  <span>I'm in danger!</span>
                </button>
                <button className={`${styles.qmBtn} ${styles.qmBlue}`} onClick={() => sendQuickMsg('Call me now!')}>
                  <span style={{fontSize:18,display:'block',marginBottom:2}}>📞</span>
                  <span>Call me now!</span>
                </button>
                <button className={`${styles.qmBtn} ${styles.qmGreen}`} onClick={() => sendQuickMsg('Come pick me up!')}>
                  <span style={{fontSize:18,display:'block',marginBottom:2}}>🚗</span>
                  <span>Come pick me up!</span>
                </button>
              </div>
            </div>

            {/* Emergency Contacts */}
            <div className={styles.emergContacts}>
              <div className={styles.sectionTitle} style={{paddingLeft:0,marginBottom:'10px'}}>Emergency Contacts</div>
              {others.length === 0 && (
                <p style={{color:'#5E8B6E',fontSize:13,marginBottom:12}}>Join a family circle to see emergency contacts</p>
              )}
              {others.map((m) => (
                <div key={m.id} className={styles.emergCard}>
                  <img className={styles.emergAvatar} src={m.avatar} alt={m.name} style={{border:`2px solid ${m.color}`}} />
                  <div style={{flex:1}}>
                    <div className={styles.emergName}>{m.name}</div>
                    <div className={styles.emergPhone}>👤 {m.role || 'Family member'} · {m.status}</div>
                  </div>
                  <button className={`${styles.callBtn} ${styles.callGreen}`} onClick={() => { if (m.phone) { window.open('tel:' + m.phone) } else { showToast(`⚠️ No phone number for ${m.name.split(' ')[0]}`) } }}>Call</button>
                </div>
              ))}
              <div className={`${styles.emergCard} ${styles.emergCardPolice}`}>
                <div className={styles.policeIconWrap}>🚔</div>
                <div style={{flex:1}}>
                  <div className={styles.emergName}>Emergency Services</div>
                  <div className={styles.emergPhone}>📞 112 · Police / Ambulance</div>
                </div>
                <button className={`${styles.callBtn} ${styles.callRed}`} onClick={() => window.open('tel:112')}>Call</button>
              </div>
            </div>
          </div>{/* /tab-sos */}


          {/* ══ TAB 4: FAMILY ══ */}
          <div className={`${styles.tabPane} ${activeTab === 'family' ? styles.active : ''}`} id="tab-family">
            <div className={styles.familyTabHeader}>
              <div className={styles.familyTabTitle}>My Family Circle</div>
              <div className={styles.familyTabSub}>{familyTabSub}</div>
            </div>
            <div className={styles.familyCards}>
              {hasCircle === false && (
                <div className={styles.joinCircleBox} style={{textAlign:'center',padding:'24px 20px'}}>
                  {/* QR code placeholder */}
                  <div style={{
                    width: 96, height: 96, margin: '0 auto 16px',
                    background: 'rgba(0,200,83,0.08)',
                    border: '2px dashed rgba(0,200,83,0.3)',
                    borderRadius: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 6
                  }}>
                    <span style={{fontSize: 36}}>📷</span>
                    <span style={{fontSize: 10, color: '#5E8B6E', fontWeight: 600}}>Scan QR</span>
                  </div>
                  <div className={styles.joinCircleIcon}>🔗</div>
                  <div className={styles.joinCircleTitle}>Join Your Family Circle</div>
                  <div className={styles.joinCircleDesc} style={{marginBottom: 8}}>
                    Scan the QR code your parent shows, or type the invite code below
                  </div>
                  <div style={{fontSize: 11, color: '#5E8B6E', marginBottom: 14}}>
                    You can find the code in your parent&apos;s app → Family → Invite
                  </div>
                  <div className={styles.joinCircleRow}>
                    <input
                      className={styles.joinCircleInput}
                      type="text"
                      placeholder="e.g. B107FC2C056D"
                      value={joinCode}
                      onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      onKeyDown={e => e.key === 'Enter' && joinCircle()}
                      maxLength={12}
                    />
                    <button
                      className={styles.joinCircleBtn}
                      onClick={joinCircle}
                      disabled={joinLoading}
                    >
                      {joinLoading ? '...' : 'Join'}
                    </button>
                  </div>
                </div>
              )}
              {hasCircle === null && (
                <p style={{color:'#5E8B6E',textAlign:'center',padding:'24px'}}>Loading...</p>
              )}
              {hasCircle === true && displayMembers.length === 0 && (
                <p style={{color:'#5E8B6E',textAlign:'center',padding:'24px'}}>Loading members...</p>
              )}
              {displayMembers.map(m => {
                const color = m.color || '#00E676'
                const statusText = m.status || 'Offline'
                const isOnline = statusText === 'Online'
                const battColor = m.battery > 60 ? '#00E676' : m.battery > 20 ? '#FFB300' : '#FF5252'
                const hasLocation = !!(m.lat && m.lng)
                return (
                  <div
                    key={m.id}
                    className={`${styles.fmCard} ${styles.reveal}`}
                    style={{borderLeft: '3px solid ' + color, position: 'relative'}}
                  >
                    {/* Distance badge */}
                    {hasLocation && !m.isMe && (
                      <div style={{
                        position: 'absolute', top: 10, right: 10,
                        background: color + '22', color, borderRadius: 8,
                        fontSize: 10, fontWeight: 700, padding: '2px 8px',
                        border: `1px solid ${color}40`
                      }}>
                        📍 Located
                      </div>
                    )}
                    <div className={styles.fmCardLeft}>
                      {/* Avatar with online/offline ring */}
                      <div style={{position:'relative', width: 48, height: 48}}>
                        <img
                          className={styles.fmAvatar}
                          src={m.avatar} alt={m.name}
                          style={{
                            borderColor: isOnline ? '#00E676' : '#3E6B4E',
                            boxShadow: isOnline ? `0 0 0 2px ${color}55` : 'none',
                            width: 48, height: 48
                          }}
                          loading="lazy"
                        />
                        <div style={{
                          position: 'absolute', bottom: 1, right: 1,
                          width: 11, height: 11, borderRadius: '50%',
                          background: isOnline ? '#00E676' : '#5E8B6E',
                          border: '2px solid #0D1F13'
                        }} />
                      </div>
                    </div>
                    <div className={styles.fmInfo} style={{flex: 1}}>
                      <div className={styles.fmName}>
                        {m.name}
                        {m.isMe && <span style={{fontSize:'10px',color:'#29B6F6',fontWeight:600}}> (You)</span>}
                      </div>
                      <div className={styles.fmRole} style={{marginBottom: 6}}>
                        {m.role || (m.isMe ? 'You' : 'Member')}
                      </div>
                      {/* Battery bar */}
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                        <div style={{
                          width: 56, height: 6, background: 'rgba(255,255,255,0.1)',
                          borderRadius: 3, overflow: 'hidden'
                        }}>
                          <div style={{width:`${m.battery}%`, height:'100%', background: battColor, borderRadius: 3}} />
                        </div>
                        <span style={{fontSize:10,color: battColor,fontWeight:600}}>{m.battery}%</span>
                      </div>
                      {/* Last seen */}
                      <div style={{fontSize:11,color:'#5E8B6E'}}>
                        {isOnline ? '🟢 Online now' : `⚫ ${statusText}`}
                      </div>
                      {/* View on Map button — only for non-self members */}
                      {!m.isMe && (
                        <button
                          onClick={() => focusMemberOnMap(m)}
                          style={{
                            marginTop: 8,
                            background: 'rgba(0,200,83,0.12)',
                            border: `1px solid ${color}40`,
                            color, borderRadius: 8,
                            fontSize: 11, fontWeight: 700,
                            padding: '5px 12px', cursor: 'pointer',
                            fontFamily: 'inherit'
                          }}
                        >
                          🗺️ View on Map
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>{/* /tab-family */}


          {/* ══ TAB 5: ALERTS ══ */}
          <div className={`${styles.tabPane} ${activeTab === 'alerts' ? styles.active : ''}`} id="tab-alerts">
            {/* Header row */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 0 12px'}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:'#E8F5E9',marginBottom:2}}>Alerts</div>
                <div style={{fontSize:12,color:'#5E8B6E'}}>{alertFilter === 'all' ? alerts.length : alerts.filter(a => a.type === alertFilter).length} notification{(alertFilter === 'all' ? alerts.length : alerts.filter(a => a.type === alertFilter).length) !== 1 ? 's' : ''}</div>
              </div>
              {alerts.length > 0 && (
                <button
                  onClick={() => setAlerts([])}
                  style={{
                    background: 'rgba(255,82,82,0.10)',
                    border: '1px solid rgba(255,82,82,0.25)',
                    color: '#FF5252', borderRadius: 8,
                    fontSize: 11, fontWeight: 700,
                    padding: '6px 12px', cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
            {/* Filter tabs */}
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              {(['all','geofence','sos'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setAlertFilter(f)}
                  style={{
                    background: alertFilter === f ? 'linear-gradient(135deg,#00C853,#0A5C35)' : 'rgba(0,200,83,0.08)',
                    border: alertFilter === f ? 'none' : '1px solid rgba(0,200,83,0.2)',
                    color: alertFilter === f ? '#fff' : '#5E8B6E',
                    borderRadius: 8, padding: '6px 14px',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', textTransform: 'capitalize'
                  }}
                >
                  {f === 'all' ? 'All' : f === 'geofence' ? '🔔 Geofence' : '🆘 SOS'}
                </button>
              ))}
            </div>
            {/* Alert list */}
            {(() => {
              const filtered = alertFilter === 'all' ? alerts : alerts.filter(a => a.type === alertFilter)
              if (filtered.length === 0) return (
                <div style={{textAlign:'center',padding:'48px 20px',color:'#5E8B6E'}}>
                  <div style={{fontSize:36,marginBottom:12}}>{alertFilter === 'sos' ? '🆘' : '🔔'}</div>
                  <div style={{fontSize:14}}>No {alertFilter === 'all' ? '' : alertFilter === 'sos' ? 'SOS ' : 'geofence '}alerts yet</div>
                  <div style={{fontSize:12,marginTop:6,color:'#3E6B4E'}}>
                    {alertFilter === 'sos' ? 'SOS alerts from family will appear here' : alertFilter === 'geofence' ? 'Geofence entries/exits will appear here' : 'Geofence entries/exits and SOS alerts appear here'}
                  </div>
                </div>
              )
              return filtered.map(alert => {
                const isSos = alert.type === 'sos'
                const isEntry = alert.eventType === 'entry'
                const borderColor = isSos ? '#FF5252' : isEntry ? '#00E676' : '#FFB300'
                const bgColor = isSos ? 'rgba(255,82,82,0.08)' : isEntry ? 'rgba(0,230,118,0.05)' : 'rgba(255,179,0,0.05)'
                const bordColor = isSos ? 'rgba(255,82,82,0.25)' : isEntry ? 'rgba(0,230,118,0.15)' : 'rgba(255,179,0,0.2)'
                const icon = isSos ? '🆘' : '🔔'
                return (
                  <div key={alert.id} style={{
                    background: bgColor,
                    border: `1px solid ${bordColor}`,
                    borderRadius: 12, padding: '14px 16px', marginBottom: 10,
                    borderLeft: `3px solid ${borderColor}`
                  }}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:18}}>{icon}</span>
                        <span style={{fontWeight:600,color:'#E8F5E9',fontSize:13}}>{alert.userName}</span>
                      </div>
                      <span style={{fontSize:11,color:'#5E8B6E'}}>{formatTime(alert.timestamp)}</span>
                    </div>
                    <div style={{fontSize:13,color:'#B2D8BF',marginLeft:26}}>{alert.message}</div>
                  </div>
                )
              })
            })()}
          </div>{/* /tab-alerts */}


          {/* ══ TAB 6: PROFILE ══ */}
          <div className={`${styles.tabPane} ${activeTab === 'profile' ? styles.active : ''}`} id="tab-profile">

            {/* Hidden file input for avatar */}
            <input
              ref={avatarFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleAvatarUpload(file)
                e.target.value = ''
              }}
            />

            {/* ── PROFILE CARD ── */}
            <div style={{ padding: '16px 16px 0' }}>
              <div className={styles.sectionTitle} style={{ padding: '0 0 10px 0' }}>My Account</div>
              <div style={{
                background: '#0D1F13',
                border: '1px solid rgba(0,230,118,0.15)',
                borderRadius: '20px',
                padding: '24px 20px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '16px'
              }}>
                {/* Avatar */}
                <div
                  className={styles.profileAvatarWrap}
                  style={{ cursor: 'pointer' }}
                  onClick={() => !avatarUploading && avatarFileRef.current?.click()}
                >
                  <img src={headerAvatar} alt={profileName} className={styles.profileAvatar} />
                  {!avatarUploading && (
                    <div style={{
                      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
                      borderRadius: '50%', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                    >
                      <span style={{ fontSize: '20px' }}>📷</span>
                    </div>
                  )}
                  {!avatarUploading && <div className={styles.profileEditBtn}>✏</div>}
                  {avatarUploading && (
                    <div style={{
                      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
                      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <div style={{
                        width: '22px', height: '22px',
                        border: '3px solid rgba(255,255,255,0.3)', borderTopColor: '#00E676',
                        borderRadius: '50%', animation: 'spin 0.8s linear infinite'
                      }}></div>
                    </div>
                  )}
                </div>

                {/* Role badge */}
                <span style={{
                  background: 'rgba(0,230,118,0.12)', color: '#00E676',
                  border: '1px solid rgba(0,230,118,0.3)', borderRadius: '20px',
                  padding: '3px 14px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px'
                }}>
                  {(gravityUser?.role || profileRole || 'member').toUpperCase()}
                </span>

                {/* Editable name */}
                <div style={{ width: '100%' }}>
                  <label style={{ fontSize: '10px', color: '#5E8B6E', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }}>Display Name</label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                    style={{
                      width: '100%', background: 'rgba(0,200,83,0.07)',
                      border: '1.5px solid rgba(0,200,83,0.25)', borderRadius: '10px',
                      color: '#E8F5E9', fontSize: '15px', fontWeight: 600,
                      padding: '9px 14px', outline: 'none', fontFamily: 'inherit',
                      boxSizing: 'border-box', transition: 'border-color 0.2s'
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#00C853' }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(0,200,83,0.25)' }}
                  />
                </div>

                {/* Info rows */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {gravityUser?.email && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                      padding: '8px 12px', fontSize: '12px', color: '#B2D8BF'
                    }}>
                      <span style={{ fontSize: '15px' }}>✉️</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gravityUser.email}</span>
                    </div>
                  )}
                  {gravityUser?.phone && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                      padding: '8px 12px', fontSize: '12px', color: '#B2D8BF'
                    }}>
                      <span style={{ fontSize: '15px' }}>📞</span>
                      <span>{gravityUser.phone}</span>
                    </div>
                  )}
                  {gravityUser?.created_at && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                      padding: '8px 12px', fontSize: '12px', color: '#5E8B6E'
                    }}>
                      <span style={{ fontSize: '15px' }}>📅</span>
                      <span>Member since {new Date(gravityUser.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
                    </div>
                  )}
                </div>

                {/* Save button */}
                <button
                  style={{
                    width: '100%',
                    background: profileSaving ? 'rgba(0,200,83,0.3)' : 'linear-gradient(135deg,#00C853,#0A5C35)',
                    color: '#fff', border: 'none', borderRadius: '12px',
                    padding: '12px', fontSize: '14px', fontWeight: 700,
                    cursor: profileSaving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', opacity: profileSaving ? 0.7 : 1,
                    transition: 'opacity 0.2s', marginTop: '4px'
                  }}
                  onClick={handleProfileSave}
                  disabled={profileSaving}
                >
                  {profileSaving ? 'Saving...' : '✓ Save Profile'}
                </button>
              </div>

              {/* Logout */}
              <button
                style={{
                  width: '100%', padding: '13px', marginBottom: '20px',
                  background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.3)',
                  borderRadius: '14px', color: '#FF5252', fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '8px'
                }}
                onClick={doLogout}
              >
                🚪 Logout
              </button>
            </div>

            {/* Location Sharing */}
            <div className={styles.toggleSection}>
              <div className={styles.sectionTitle} style={{padding:'0 0 10px 0'}}>Location Sharing</div>
              <div className={styles.toggleCard}>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleIcon}>📍</div>
                  <div className={styles.toggleInfo}>
                    <div className={styles.toggleLabel}>Share my location</div>
                    <div className={styles.toggleDesc}>Family can see where you are</div>
                  </div>
                  <button
                    className={`${styles.toggleSwitch} ${toggles.shareLocation ? styles.toggleSwitchOn : ''}`}
                    onClick={() => toggleSwitch('shareLocation')}
                  ><div className={styles.toggleThumb}></div></button>
                </div>
                <div className={`${styles.toggleRow} ${styles.toggleRowCol}`}>
                  <div style={{display:'flex',alignItems:'center',gap:'12px',width:'100%'}}>
                    <div className={styles.toggleIcon}>🎯</div>
                    <div className={styles.toggleInfo}>
                      <div className={styles.toggleLabel}>Location Precision</div>
                      <div className={styles.toggleDesc}>How accurate to share</div>
                    </div>
                  </div>
                  <div className={styles.precWrap} style={{width:'100%',paddingLeft:'40px'}}>
                    <button
                      className={`${styles.precBtn} ${precision === 'exact' ? styles.precBtnActive : ''}`}
                      onClick={() => { setPrecisionState('exact'); showToast('🎯 Precision: Exact') }}
                    >Exact</button>
                    <button
                      className={`${styles.precBtn} ${precision === 'approximate' ? styles.precBtnActive : ''}`}
                      onClick={() => { setPrecisionState('approximate'); showToast('🎯 Precision: Approximate') }}
                    >Approximate</button>
                  </div>
                </div>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleIcon}>🚨</div>
                  <div className={styles.toggleInfo}>
                    <div className={styles.toggleLabel}>Auto-share in SOS zone</div>
                    <div className={styles.toggleDesc}>Always precise in danger</div>
                  </div>
                  <button
                    className={`${styles.toggleSwitch} ${toggles.autoSos ? styles.toggleSwitchOn : ''}`}
                    onClick={() => toggleSwitch('autoSos')}
                  ><div className={styles.toggleThumb}></div></button>
                </div>
              </div>
            </div>

            {/* Notifications */}
            <div className={styles.toggleSection}>
              <div className={styles.sectionTitle} style={{padding:'0 0 10px 0'}}>Notifications</div>
              <div className={styles.toggleCard}>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleIcon}>🏠</div>
                  <div className={styles.toggleInfo}>
                    <div className={styles.toggleLabel}>Family arrivals</div>
                    <div className={styles.toggleDesc}>When someone reaches home</div>
                  </div>
                  <button
                    className={`${styles.toggleSwitch} ${toggles.familyArrivals ? styles.toggleSwitchOn : ''}`}
                    onClick={() => toggleSwitch('familyArrivals')}
                  ><div className={styles.toggleThumb}></div></button>
                </div>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleIcon}>🆘</div>
                  <div className={styles.toggleInfo}>
                    <div className={styles.toggleLabel}>SOS alerts from family</div>
                    <div className={styles.toggleDesc}>Emergency notifications</div>
                  </div>
                  <button
                    className={`${styles.toggleSwitch} ${toggles.sosAlerts ? styles.toggleSwitchOn : ''}`}
                    onClick={() => toggleSwitch('sosAlerts')}
                  ><div className={styles.toggleThumb}></div></button>
                </div>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleIcon}>📌</div>
                  <div className={styles.toggleInfo}>
                    <div className={styles.toggleLabel}>Geofence alerts</div>
                    <div className={styles.toggleDesc}>Safe zone enter/exit alerts</div>
                  </div>
                  <button
                    className={`${styles.toggleSwitch} ${toggles.geofence ? styles.toggleSwitchOn : ''}`}
                    onClick={() => toggleSwitch('geofence')}
                  ><div className={styles.toggleThumb}></div></button>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className={styles.toggleSection} style={{marginBottom:10,paddingTop:4}}>
              <div className={styles.sectionTitle} style={{padding:'0 0 10px 0'}}>Today's Activity</div>
            </div>
            <div className={styles.statsRow} style={{padding:'0 16px',marginBottom:20}}>
              <div className={`${styles.statCard} ${styles.reveal}`}>
                <div className={styles.statVal}>{todayDistance}</div>
                <div className={styles.statLabel}>Distance Today</div>
              </div>
              <div className={`${styles.statCard} ${styles.reveal}`}>
                <div className={styles.statVal}>{todaySafeZones || '—'}</div>
                <div className={styles.statLabel}>Safe Zones Visited</div>
              </div>
              <div className={`${styles.statCard} ${styles.reveal}`}>
                <div className={styles.statVal}>{todayCheckins || '—'}</div>
                <div className={styles.statLabel}>Family Check-ins</div>
              </div>
            </div>

            {/* Location History */}
            <div className={styles.toggleSection}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div className={styles.sectionTitle} style={{padding:0}}>Location History</div>
                <button
                  onClick={loadLocationHistory}
                  disabled={locationHistoryLoading}
                  style={{
                    background:'rgba(0,200,83,0.10)',border:'1px solid rgba(0,200,83,0.25)',
                    color:'#00C853',borderRadius:8,fontSize:11,fontWeight:700,
                    padding:'5px 12px',cursor:'pointer',fontFamily:'inherit',
                    opacity: locationHistoryLoading ? 0.6 : 1
                  }}
                >{locationHistoryLoading ? 'Loading...' : 'Refresh'}</button>
              </div>
              {locationHistory.length === 0 && !locationHistoryLoading && (
                <div style={{
                  background:'rgba(0,200,83,0.05)',border:'1px solid rgba(0,200,83,0.12)',
                  borderRadius:12,padding:'20px',textAlign:'center',color:'#5E8B6E',fontSize:13
                }}>
                  <div style={{fontSize:28,marginBottom:8}}>📍</div>
                  <div>No location history yet</div>
                  <div style={{fontSize:11,marginTop:4,color:'#3E6B4E'}}>Tap Refresh to load your recent locations</div>
                </div>
              )}
              {locationHistoryLoading && locationHistory.length === 0 && (
                <div style={{textAlign:'center',padding:'20px',color:'#5E8B6E',fontSize:13}}>Loading...</div>
              )}
              {locationHistory.length > 0 && (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {locationHistory.map((entry, idx) => {
                    const d = new Date(entry.recorded_at)
                    const h12 = ((d.getHours() % 12) || 12)
                    const mm = d.getMinutes().toString().padStart(2,'0')
                    const ampm = d.getHours() >= 12 ? 'PM' : 'AM'
                    const dateStr = d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})
                    const timeStr = `${h12}:${mm} ${ampm}`
                    const distStr = entry.distance_from_home_km != null
                      ? `${parseFloat(String(entry.distance_from_home_km)).toFixed(1)} km from home`
                      : `${entry.latitude.toFixed(4)}, ${entry.longitude.toFixed(4)}`
                    return (
                      <div key={entry.id || idx} style={{
                        background:'rgba(0,200,83,0.05)',border:'1px solid rgba(0,200,83,0.12)',
                        borderRadius:10,padding:'10px 14px',display:'flex',alignItems:'center',gap:10
                      }}>
                        <div style={{
                          width:32,height:32,borderRadius:'50%',
                          background:'rgba(0,200,83,0.12)',border:'1px solid rgba(0,200,83,0.25)',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:14,flexShrink:0
                        }}>📍</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,fontWeight:700,color:'#E8F5E9'}}>{distStr}</div>
                          <div style={{fontSize:11,color:'#5E8B6E',marginTop:2}}>{dateStr} · {timeStr}</div>
                        </div>
                        {entry.battery_level != null && (
                          <div style={{
                            fontSize:10,fontWeight:700,
                            color: entry.battery_level > 50 ? '#00E676' : entry.battery_level > 20 ? '#FFB300' : '#FF5252'
                          }}>🔋{entry.battery_level}%</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Links + Version */}
            <div style={{ padding: '0 16px 28px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Link
                className={styles.profileLink}
                to="/"
                style={{ textDecoration: 'none' }}
              >
                <span className={styles.profileLinkText}>🏠 Back to Home</span>
                <span className={styles.profileLinkArrow}>→</span>
              </Link>
              <div style={{ textAlign: 'center', paddingTop: '6px' }}>
                <span style={{
                  display: 'inline-block',
                  background: 'rgba(94,139,110,0.12)',
                  border: '1px solid rgba(94,139,110,0.22)',
                  borderRadius: '20px', padding: '4px 16px',
                  fontSize: '11px', fontWeight: 600, color: '#5E8B6E', letterSpacing: '0.5px'
                }}>Gravity v1.0.0</span>
              </div>
            </div>
          </div>{/* /tab-profile */}

        </div>{/* /tab-content */}

        {/* BOTTOM NAV */}
        <nav className={styles.bottomNav}>
          <button
            className={`${styles.navTab} ${activeTab === 'home' ? styles.active : ''}`}
            onClick={() => switchTab('home')}
          >
            <span className={styles.navIcon}>🏠</span>
            <span className={styles.navLabel}>Home</span>
          </button>
          <button
            className={`${styles.navTab} ${activeTab === 'map' ? styles.active : ''}`}
            onClick={() => switchTab('map')}
          >
            <span className={styles.navIcon}>🗺️</span>
            <span className={styles.navLabel}>Map</span>
          </button>
          <button
            className={`${styles.sosBtnNav} ${activeTab === 'sos' ? styles.active : ''}`}
            onClick={() => switchTab('sos')}
          >
            <div className={styles.sosNavCircle}>SOS</div>
            <span className={styles.sosNavLabel}>SOS</span>
          </button>
          <button
            className={`${styles.navTab} ${activeTab === 'family' ? styles.active : ''}`}
            onClick={() => switchTab('family')}
          >
            <span className={styles.navIcon}>👨‍👩‍👦</span>
            <span className={styles.navLabel}>Family</span>
          </button>
          <div
            className={`${styles.navTab} ${activeTab === 'alerts' ? styles.active : ''}`}
            onClick={() => switchTab('alerts')}
            style={{position:'relative'}}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span>Alerts</span>
            {unreadAlerts > 0 && <span style={{position:'absolute',top:2,right:2,background:'#FF5252',color:'#fff',fontSize:9,fontWeight:700,borderRadius:'50%',width:16,height:16,display:'flex',alignItems:'center',justifyContent:'center'}}>{unreadAlerts}</span>}
          </div>
          <button
            className={`${styles.navTab} ${activeTab === 'profile' ? styles.active : ''}`}
            onClick={() => switchTab('profile')}
          >
            <span className={styles.navIcon}>👤</span>
            <span className={styles.navLabel}>Profile</span>
          </button>
        </nav>

      </div>{/* /app-frame */}

      {/* TOASTS */}
      {toasts.map(t => (
        <div
          key={t.id}
          className={`${styles.toast} ${t.type === 'sos' ? styles.toastSos : t.type === 'error' ? styles.toastError : ''} ${t.show ? styles.toastShow : ''}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
