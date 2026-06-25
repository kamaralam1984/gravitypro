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
  lastSeenAt: number | null
}

// A member is ONLINE if their location/heartbeat is fresh within this window.
// Matches the mobile app + the 60s presence heartbeat (which keeps a stationary
// phone-on child fresh well inside the window).
const ONLINE_WINDOW_MS = 10 * 60 * 1000
const freshStatus = (lastSeenAt: number | null): 'active' | 'offline' =>
  lastSeenAt != null && Date.now() - lastSeenAt < ONLINE_WINDOW_MS ? 'active' : 'offline'

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
  center_lat: number
  center_lng: number
  active: boolean
  assigned_user_id: string | null
  category: string
  assigned_user_name?: string | null
}

const ZONE_CATEGORIES = ['home', 'school', 'tuition', 'playground', 'music', 'dance', 'other'] as const

type Contact = { id: string; name: string; phone?: string; relation?: string }

// ── LEAFLET DYNAMIC IMPORT ──
declare const L: typeof import('leaflet')

// ── DISTANCE HELPERS ──
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function fmtDist(m: number): string {
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km'
}
function nearestZone(lat: number | null, lng: number | null, zones: Zone[], memberId?: string): { name: string; dist: number; inside: boolean } | null {
  if (lat == null || lng == null) return null
  let best: { name: string; dist: number; inside: boolean } | null = null
  for (const z of zones) {
    if (z.center_lat == null || z.center_lng == null) continue
    if (z.assigned_user_id && memberId && z.assigned_user_id !== memberId) continue
    const d = haversineMeters(lat, lng, z.center_lat, z.center_lng)
    if (!best || d < best.dist) best = { name: z.name, dist: d, inside: d <= z.radius }
  }
  return best
}

function groupZones(zones: Zone[], members: Member[]) {
  const shared = zones.filter((z) => !z.assigned_user_id)
  const byMember = new Map<string, Zone[]>()
  zones.filter((z) => z.assigned_user_id).forEach((z) => {
    const k = z.assigned_user_id as string
    if (!byMember.has(k)) byMember.set(k, [])
    byMember.get(k)!.push(z)
  })
  const groups: { key: string; label: string; zones: Zone[] }[] = []
  if (shared.length) groups.push({ key: 'shared', label: 'Shared · whole family', zones: shared })
  byMember.forEach((zs, uid) => {
    const name = zs[0].assigned_user_name || members.find((m) => m.id === uid)?.name || 'Member'
    groups.push({ key: uid, label: name, zones: zs })
  })
  return groups
}

const API_BASE = window.location.origin + '/api/v1'

function getToken(): string | null { return localStorage.getItem('gravity_token') }
function getUser(): { name?: string; email?: string; avatar_url?: string; account_type?: string } | null {
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

async function apiPatch(path: string, body: unknown) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function apiDelete(path: string) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!res.ok) throw await res.json().catch(() => ({}))
  return res.json().catch(() => ({}))
}

export default function ParentPanel() {
  const navigate = useNavigate()
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<InstanceType<typeof L.Map> | null>(null)
  const tileLayerRef = useRef<InstanceType<typeof L.TileLayer> | null>(null)
  const memberMarkersRef = useRef<Record<string, InstanceType<typeof L.Marker>>>({})
  const zoneCirclesRef = useRef<InstanceType<typeof L.Circle>[]>([])
  const mapInitedRef = useRef(false)

  const [activeTab, setActiveTab] = useState<'map' | 'family' | 'alerts' | 'geofence' | 'settings'>('map')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mapType, setMapType] = useState<'dark' | 'light' | 'satellite' | 'street'>('dark')
  const [members, setMembers] = useState<Member[]>([])
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [circleId, setCircleId] = useState<string | null>(null)
  const [allCircles, setAllCircles] = useState<{ id: string; name: string; invite_code?: string }[]>([])
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
  const [znAssigned, setZnAssigned] = useState('')
  const [znCategory, setZnCategory] = useState('other')
  const [showEditZoneModal, setShowEditZoneModal] = useState(false)
  const [editingZone, setEditingZone] = useState<Zone | null>(null)
  const [ezName, setEzName] = useState('')
  const [ezLat, setEzLat] = useState('')
  const [ezLng, setEzLng] = useState('')
  const [ezRadius, setEzRadius] = useState('')
  const [ezAssigned, setEzAssigned] = useState('')
  const [ezCategory, setEzCategory] = useState('other')
  // Add child
  const [showChildModal, setShowChildModal] = useState(false)
  const [childName, setChildName] = useState('')
  const [childDob, setChildDob] = useState('')
  const [childCircleId, setChildCircleId] = useState('')
  const [childSaving, setChildSaving] = useState(false)
  // Emergency contacts
  const [contacts, setContacts] = useState<Contact[]>([])
  const [ecName, setEcName] = useState('')
  const [ecPhone, setEcPhone] = useState('')
  const [ecRelation, setEcRelation] = useState('')
  // Weekly reports
  const [reportMemberId, setReportMemberId] = useState('')
  const [weekly, setWeekly] = useState<{
    totals: { totalDistanceMeters: number; timeAtHomeSec: number; timeAtSchoolSec: number }
    days: { date: string; distanceMeters: number; placesVisited: number; timeAtHomeSec: number; timeAtSchoolSec: number }[]
  } | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [segmentVal, setSegmentVal] = useState('Exact')
  const [notifCount, setNotifCount] = useState(0)
  const [showCreateCircleModal, setShowCreateCircleModal] = useState(false)
  const [newCircleName, setNewCircleName] = useState('')
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [circleInviteCode, setCircleInviteCode] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [circleModalTab, setCircleModalTab] = useState<'create' | 'join'>('create')
  const [circleModalLoading, setCircleModalLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyPoints, setHistoryPoints] = useState<{ latitude: number; longitude: number }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [, setHistoryMemberId] = useState<string | null>(null)
  const avatarFileInputRef = useRef<HTMLInputElement>(null)
  const sseRef = useRef<EventSource | null>(null)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── FULLSCREEN ──
  function toggleFullscreen() {
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

  // ── PRESENCE TICK ── re-derive online/offline from freshness every 30s so a
  // member whose heartbeat stops (phone off / no internet) flips to Offline,
  // and one that resumes flips back to Online. SOS state is never overridden.
  useEffect(() => {
    const id = setInterval(() => {
      setMembers(prev => {
        let changed = false
        const next = prev.map(m => {
          if (m.status === 'sos') return m
          const s = freshStatus(m.lastSeenAt)
          if (s === m.status) return m
          changed = true
          return { ...m, status: s }
        })
        return changed ? next : prev
      })
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // ── CLEANUP ON UNMOUNT ──
  useEffect(() => {
    return () => {
      sseRef.current?.close()
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    }
  }, [])

  // ── AUTH GUARD ──
  useEffect(() => {
    if (!getToken()) {
      localStorage.setItem('gravity_redirect', '/parent/panel')
      navigate('/login')
      return
    }
    // Role guard: only parents may use the parent panel.
    const u = getUser()
    if (!u || !u.account_type) {
      navigate('/login')
    } else if (u.account_type !== 'parent') {
      navigate('/child/panel')
    }
  }, [navigate])

  // ── LOAD EMERGENCY CONTACTS ──
  useEffect(() => {
    if (getToken()) loadContacts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── INIT USER PROFILE ──
  useEffect(() => {
    const user = getUser()
    if (user) {
      setUserName(user.name || 'User')
      setUserEmail(user.email || '')
      setProfileName(user.name || '')
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
      const nz = nearestZone(m.lat!, m.lng!, zones, m.id)
      const distLine = nz
        ? `<div style="font-size:10px;color:${nz.inside ? '#00E676' : '#5E8B6E'};margin-top:2px;">${nz.inside ? '🛡️ Inside ' + nz.name : '📍 ' + fmtDist(nz.dist) + ' from ' + nz.name}</div>`
        : ''
      const marker = L2.marker([m.lat!, m.lng!], { icon }).addTo(leafletMapRef.current!)
      marker.bindPopup(
        `<div style="font-family:'Plus Jakarta Sans',sans-serif;background:#0D1F13;color:#fff;border:1px solid rgba(0,230,118,0.2);border-radius:10px;padding:10px;min-width:140px;">
          <div style="font-weight:800;font-size:13px;color:${color};margin-bottom:4px;">${m.name}</div>
          <div style="font-size:11px;color:#5E8B6E;margin-bottom:2px;">${m.role}</div>
          <div style="font-size:10px;color:#5E8B6E;margin-top:4px;">🔋 ${m.battery}%</div>
          ${distLine}
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
  }, [members, zones, activeTab])

  // ── MAP SAFE-ZONE CIRCLES ──
  useEffect(() => {
    if (!leafletMapRef.current) return
    const L2 = (window as unknown as { L: typeof import('leaflet') }).L
    if (!L2) return
    zoneCirclesRef.current.forEach((c) => leafletMapRef.current!.removeLayer(c))
    zoneCirclesRef.current = []
    zones
      .filter((z) => z.active && z.center_lat != null && z.center_lng != null)
      .forEach((z) => {
        const circle = L2.circle([z.center_lat, z.center_lng], {
          radius: z.radius,
          color: '#00E676',
          weight: 2,
          fillColor: '#00E676',
          fillOpacity: 0.12,
        }).addTo(leafletMapRef.current!)
        circle.bindPopup(
          `<div style="font-family:'Plus Jakarta Sans',sans-serif;background:#0D1F13;color:#fff;border:1px solid rgba(0,230,118,0.2);border-radius:10px;padding:10px;min-width:140px;">
            <div style="font-weight:800;font-size:13px;color:#00E676;margin-bottom:4px;">🛡️ ${z.name}</div>
            <div style="font-size:10px;color:#5E8B6E;">Radius: ${z.radius} m · ${z.assigned_user_name ? 'For ' + z.assigned_user_name : 'Shared'} · ${z.category}</div>
          </div>`,
          { className: 'custom-popup' }
        )
        zoneCirclesRef.current.push(circle)
      })
  }, [zones, members, activeTab])

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
      setAllCircles(data.circles)
      const cid = data.circles[0].id
      setCircleId(cid)
      setCircleInviteCode(data.circles[0].invite_code || '')
      await Promise.all([loadMembers(cid), loadAlerts(cid), loadGeofences(cid)])
      connectSSE(cid)
      // Auto-refresh member locations every 30 seconds as fallback
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
      autoRefreshRef.current = setInterval(() => { loadMembers(cid) }, 30000)
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
      status: freshStatus(m.location_updated_at ? new Date(m.location_updated_at as string).getTime() : null),
      battery: m.battery_level != null ? Math.round(m.battery_level as number) : 50,
      color: colors[i % colors.length],
      avatar: (m.avatar_url as string) || 'https://picsum.photos/seed/' + encodeURIComponent(m.name as string) + '/56/56',
      role: (m.role as string) || 'Member',
      lastSeen: m.location_updated_at ? new Date(m.location_updated_at as string).toLocaleTimeString() : 'Unknown',
      lastSeenAt: m.location_updated_at ? new Date(m.location_updated_at as string).getTime() : null,
    }))
    setMembers(loaded)
    const active = loaded.filter((m) => m.status === 'active').length
    setFamilyCount(loaded.length + ' member' + (loaded.length !== 1 ? 's' : '') + ' · ' + active + ' active')
  }

  async function loadAlerts(cid: string) {
    const icons: Record<string, string> = { exit: '🚨', entry: '📍', sos: '🆘' }
    const labels: Record<string, (z: string) => string> = {
      exit: (z) => 'Left ' + z,
      entry: (z) => 'Arrived at ' + z,
      sos: () => 'SOS Alert',
    }
    const typeMap: Record<string, AlertItem['type']> = { exit: 'geo', entry: 'geo', sos: 'sos' }

    // Load geofence events
    const geoData = await apiGet('/geofences/events/' + cid)
    const geoAlerts: AlertItem[] = (geoData?.events || []).slice(0, 10).map((e: Record<string, unknown>) => ({
      id: 'geo-' + e.id,
      type: typeMap[e.event_type as string] || 'geo',
      icon: icons[e.event_type as string] || '📍',
      title: (e.user_name || 'Member') + ' — ' + (labels[e.event_type as string] || (() => e.event_type))(e.zone_name as string || ''),
      subtitle: '',
      time: new Date(e.created_at as string).toLocaleString(),
      dismissed: false,
    }))

    // Load SOS history
    const sosData = await apiGet('/sos/history')
    const sosAlerts: AlertItem[] = (sosData?.sos_events || sosData?.events || []).slice(0, 5).map((e: Record<string, unknown>) => ({
      id: 'sos-' + e.id,
      type: 'sos' as AlertItem['type'],
      icon: '🆘',
      title: (e.user_name || e.userName || 'Member') + ' sent SOS alert',
      subtitle: e.latitude ? (e.latitude as number).toFixed(4) + ', ' + (e.longitude as number).toFixed(4) : '',
      time: new Date((e.created_at || e.timestamp) as string).toLocaleString(),
      dismissed: false,
    }))

    // Merge: SOS first, then geofence events, deduplicate by id
    const merged = [...sosAlerts, ...geoAlerts].slice(0, 15)
    setAlerts(merged)
    setNotifCount(merged.length)
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
      center_lat: z.center_lat as number,
      center_lng: z.center_lng as number,
      active: z.active !== false,
      assigned_user_id: (z.assigned_user_id as string) ?? null,
      category: (z.category as string) || 'other',
      assigned_user_name: (z.assigned_user_name as string) ?? null,
    }))
    setZones(loaded)
    setZoneSubtitle(loaded.length + ' zone' + (loaded.length !== 1 ? 's' : '') + ' active')
  }

  // ── EMERGENCY CONTACTS ──
  async function loadContacts() {
    try {
      const r = await apiGet('/family/emergency-contacts')
      setContacts(r?.contacts || [])
    } catch { /* ignore */ }
  }

  async function addContact() {
    if (!ecName.trim()) { showToast('Contact name required', 'error'); return }
    try {
      const res = await apiPost('/family/emergency-contacts', {
        name: ecName.trim(),
        phone: ecPhone.trim() || undefined,
        relation: ecRelation.trim() || undefined,
      })
      if (res?.contact) {
        setEcName(''); setEcPhone(''); setEcRelation('')
        showToast('Contact added', 'success')
        loadContacts()
      } else {
        showToast(res?.error || 'Failed to add contact', 'error')
      }
    } catch (e: unknown) {
      showToast((e as { error?: string })?.error || 'Failed to add contact', 'error')
    }
  }

  async function deleteContact(id: string) {
    if (!confirm('Delete this emergency contact?')) return
    try {
      await apiDelete('/family/emergency-contacts/' + id)
      showToast('Contact removed', 'success')
      loadContacts()
    } catch { showToast('Failed to remove contact', 'error') }
  }

  // ── ADD CHILD ──
  function openChildModal() {
    setChildName('')
    setChildDob('')
    setChildCircleId(circleId || (allCircles[0]?.id ?? ''))
    setShowChildModal(true)
  }

  async function addChild() {
    if (!childCircleId || !childName.trim()) { showToast('Pick a circle and enter a name', 'error'); return }
    setChildSaving(true)
    try {
      const body: Record<string, string> = { circle_id: childCircleId, name: childName.trim() }
      if (childDob) body.dob = childDob
      const res = await apiPost('/family/children', body)
      if (res?.child) {
        showToast('Child added!', 'success')
        setShowChildModal(false)
        setChildName(''); setChildDob('')
        if (childCircleId === circleId) await loadMembers(childCircleId)
      } else {
        showToast(res?.error || 'Failed to add child', 'error')
      }
    } catch (e: unknown) {
      showToast((e as { error?: string })?.error || 'Failed to add child', 'error')
    } finally { setChildSaving(false) }
  }

  // ── WEEKLY REPORT ──
  async function loadWeekly(userId: string) {
    setReportMemberId(userId)
    if (!userId) { setWeekly(null); return }
    setReportLoading(true)
    try {
      const r = await apiGet('/reports/weekly/' + userId)
      setWeekly(r && r.totals ? r : null)
    } catch { setWeekly(null) }
    finally { setReportLoading(false) }
  }

  async function downloadWeeklyCsv() {
    if (!reportMemberId) return
    try {
      const token = getToken()
      const res = await fetch(API_BASE + '/reports/weekly/' + reportMemberId + '.csv', {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) { showToast('Failed to download CSV', 'error'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'weekly-report.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch { showToast('Failed to download CSV', 'error') }
  }

  function connectSSE(cid: string) {
    const token = getToken()
    if (!token || !cid) return
    // Close any existing SSE connection before opening a new one
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }
    const evtSource = new EventSource(API_BASE + '/sse/stream?token=' + token)
    sseRef.current = evtSource
    evtSource.addEventListener('location_update', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setMembers((prev) =>
        prev.map((m) =>
          m.id === d.userId
            ? { ...m, lat: d.latitude, lng: d.longitude, battery: d.battery_level != null ? Math.round(d.battery_level) : m.battery, lastSeen: new Date().toLocaleTimeString(), lastSeenAt: Date.now(), status: 'active' as const }
            : m
        )
      )
      // Update existing marker position in-place (no full re-render needed)
      if (memberMarkersRef.current[d.userId]) {
        memberMarkersRef.current[d.userId].setLatLng([d.latitude, d.longitude])
      }
    })
    evtSource.addEventListener('sos_alert', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      showToast('🆘 SOS from ' + (d.userName || 'Member') + '!', 'error')
      const newAlert: AlertItem = {
        id: 'sos-live-' + Date.now(),
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
    evtSource.onerror = () => {
      evtSource.close()
      sseRef.current = null
    }
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
    const alert = alerts.find((a) => a.id === id)
    // SOS alerts must be persisted as resolved on the backend; geofence/battery
    // alerts are local-only dismissals. Best-effort: still remove locally on failure.
    if (alert?.type === 'sos') {
      apiPatch('/sos/' + id + '/resolve', {}).catch((err) => {
        console.error('Failed to resolve SOS alert', id, err)
      })
    }
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    setNotifCount((c) => Math.max(0, c - 1))
  }

  // ── GEOFENCE ACTIONS ──
  async function toggleZone(id: string, checked: boolean) {
    // Optimistic local update, then persist; roll back if the request fails.
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, active: checked } : z)))
    try {
      const res = await apiPatch('/geofences/' + id, { active: checked })
      if (res?.error || res === null) throw new Error(res?.error || 'failed')
      showToast(checked ? 'Zone enabled' : 'Zone disabled', 'success')
    } catch {
      // revert on failure
      setZones((prev) => prev.map((z) => (z.id === id ? { ...z, active: !checked } : z)))
      showToast('Could not update zone', 'error')
    }
  }

  function openZoneModal() {
    setZnName('')
    setZnRadius('200')
    setZnAssigned('')
    setZnCategory('other')
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
      const res = await apiPost('/geofences', { circle_id: circleId, name, center_lat: lat, center_lng: lng, radius_meters: radius, assigned_user_id: znAssigned || null, category: znCategory })
      if (res?.safe_zone) {
        setShowZoneModal(false)
        showToast('Safe zone created!', 'success')
        await loadGeofences(circleId)
      } else {
        showToast(res?.error || 'Failed to create zone', 'error')
      }
    } catch { showToast('Network error', 'error') }
  }

  function openEditZone(z: Zone) {
    setEditingZone(z)
    setEzName(z.name)
    setEzLat(z.center_lat?.toString() || '')
    setEzLng(z.center_lng?.toString() || '')
    setEzRadius(z.radius.toString())
    setEzAssigned(z.assigned_user_id || '')
    setEzCategory(z.category || 'other')
    setShowEditZoneModal(true)
  }

  async function updateZone() {
    if (!editingZone) return
    const name = ezName.trim()
    const lat = parseFloat(ezLat)
    const lng = parseFloat(ezLng)
    const radius = parseInt(ezRadius)
    if (!name) { showToast('Zone name required', 'error'); return }
    if (isNaN(lat) || isNaN(lng)) { showToast('Valid coordinates required', 'error'); return }
    if (!radius || radius < 50) { showToast('Radius must be at least 50m', 'error'); return }
    try {
      const res = await apiPatch('/geofences/' + editingZone.id, { name, center_lat: lat, center_lng: lng, radius_meters: radius, assigned_user_id: ezAssigned || null, category: ezCategory })
      if (res?.safe_zone) {
        showToast('Zone updated!', 'success')
        setShowEditZoneModal(false)
        setEditingZone(null)
        if (circleId) await loadGeofences(circleId)
      } else {
        showToast(res?.error || 'Failed to update zone', 'error')
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

  async function loadFamily() {
    await loadRealData()
  }

  // ── RELOAD DATA WHEN circleId CHANGES ──
  useEffect(() => {
    if (circleId) {
      loadMembers(circleId)
      loadGeofences(circleId)
      loadAlerts(circleId)
    }
  }, [circleId])

  // ── LOAD HISTORY ──
  const loadHistory = async (userId: string) => {
    setHistoryLoading(true)
    setHistoryMemberId(userId)
    setShowHistory(true)
    const data = await apiGet('/users/me/location-history?limit=50')
    if (data?.locations) {
      setHistoryPoints(data.locations)
      if (leafletMapRef.current && data.locations.length > 1) {
        const coords = data.locations.map((p: { latitude: number; longitude: number }) => [p.latitude, p.longitude])
        const L2 = (window as unknown as { L: typeof import('leaflet') }).L
        L2 && L2.polyline(coords, { color: '#00E676', weight: 3, opacity: 0.8, dashArray: '6,4' }).addTo(leafletMapRef.current)
      }
    }
    setHistoryLoading(false)
  }

  async function createCircle() {
    const name = newCircleName.trim()
    if (!name) { showToast('Circle name required', 'error'); return }
    setCircleModalLoading(true)
    try {
      const res = await apiPost('/circles', { name })
      if (res?.circle) {
        showToast('Circle created! ✓', 'success')
        setShowCreateCircleModal(false)
        setNewCircleName('')
        await loadFamily()
      } else {
        showToast(res?.error || 'Failed to create circle', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setCircleModalLoading(false) }
  }

  async function joinCircle() {
    const code = inviteCodeInput.trim().toUpperCase()
    if (!code) { showToast('Invite code required', 'error'); return }
    setCircleModalLoading(true)
    try {
      const res = await apiPost('/circles/join', { invite_code: code })
      if (res?.circle) {
        showToast('Joined circle! ✓', 'success')
        setShowCreateCircleModal(false)
        setInviteCodeInput('')
        await loadFamily()
      } else {
        showToast(res?.error || 'Invalid invite code', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setCircleModalLoading(false) }
  }

  // ── AVATAR UPLOAD ──
  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      // Step 1: get presigned URL
      const presignRes = await apiPost('/media/avatar/presign', { contentType: file.type, fileSize: file.size })
      if (!presignRes?.uploadUrl || !presignRes?.publicUrl) {
        showToast('Failed to start upload', 'error')
        return
      }
      const { uploadUrl, publicUrl } = presignRes
      // Step 2: PUT file binary to R2
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      // Step 3: confirm
      const confirmRes = await apiPost('/media/avatar/confirm', { publicUrl })
      const newAvatarUrl = confirmRes?.avatar_url || publicUrl
      setUserAvatar(newAvatarUrl)
      // persist to localStorage
      try {
        const stored = JSON.parse(localStorage.getItem('gravity_user') || 'null') || {}
        stored.avatar_url = newAvatarUrl
        localStorage.setItem('gravity_user', JSON.stringify(stored))
      } catch { /* ignore */ }
      showToast('Avatar updated!', 'success')
    } catch {
      showToast('Upload failed', 'error')
    } finally {
      setAvatarUploading(false)
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = ''
    }
  }

  // ── PROFILE SAVE ──
  async function saveProfile() {
    const name = profileName.trim()
    if (!name) { showToast('Name cannot be empty', 'error'); return }
    setProfileSaving(true)
    try {
      const res = await apiPatch('/users/me', { name })
      if (res?.status === 404 || res?.error?.includes?.('Cannot') || res === null) {
        showToast('Profile update coming soon', 'success')
      } else if (res?.id || res?.name) {
        const updatedName = res.name || name
        setUserName(updatedName)
        setProfileName(updatedName)
        try {
          const stored = JSON.parse(localStorage.getItem('gravity_user') || 'null') || {}
          stored.name = updatedName
          localStorage.setItem('gravity_user', JSON.stringify(stored))
        } catch { /* ignore */ }
        showToast('Profile saved!', 'success')
      } else if (res?.error) {
        showToast(res.error, 'error')
      } else {
        // endpoint may not exist yet
        showToast('Profile update coming soon', 'success')
      }
    } catch {
      showToast('Profile update coming soon', 'success')
    } finally {
      setProfileSaving(false)
    }
  }

  // ── SETTINGS ACTIONS ──
  function doLogout() {
    if (confirm('Logout?')) {
      localStorage.removeItem('gravity_token')
      localStorage.removeItem('gravity_user')
      navigate('/login')
    }
  }
  async function confirmLeave() {
    if (!circleId) return
    if (!confirm('Are you sure you want to leave this Family Circle?')) return
    try {
      const token = getToken()
      const res = await fetch(API_BASE + '/circles/' + circleId + '/leave', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to leave circle')
      showToast('You have left the circle')
      setTimeout(() => { localStorage.removeItem('gravity_token'); localStorage.removeItem('gravity_user'); window.location.href = '/login' }, 1500)
    } catch(e: unknown) { showToast(e instanceof Error ? e.message : 'Error leaving circle', 'error') }
  }
  async function confirmDelete() {
    if (!confirm('Are you sure you want to permanently delete your account? This will delete ALL your data and cannot be undone.')) return
    if (!confirm('Final confirmation: Delete your Gravity account permanently?')) return
    try {
      const token = getToken()
      const res = await fetch(API_BASE + '/users/me', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      showToast('Account deleted. Goodbye!')
      setTimeout(() => { localStorage.clear(); sessionStorage.clear(); window.location.href = '/' }, 2000)
    } catch(e: unknown) { showToast(e instanceof Error ? e.message : 'Error deleting account', 'error') }
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

        {/* CIRCLE SWITCHER */}
        {allCircles.length > 1 && (
          <div className={styles.circleSwitcher}>
            {allCircles.map(c => (
              <button key={c.id}
                className={`${styles.circleTab} ${circleId === c.id ? styles.circleTabActive : ''}`}
                onClick={() => setCircleId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

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
                <button className={styles.historyBtn} onClick={() => showHistory ? setShowHistory(false) : loadHistory('me')}>
                  {showHistory ? 'Live' : 'History'}
                </button>
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

            {showHistory && (
              <div className={styles.historyBar}>
                {historyLoading ? (
                  <span className={styles.historyLoading}>Loading path...</span>
                ) : (
                  <>
                    <span className={styles.historyCount}>{historyPoints.length} location points</span>
                    <span className={styles.historyRange}>Last 24 hours</span>
                    <button className={styles.historyClose} onClick={() => setShowHistory(false)}>Back to Live</button>
                  </>
                )}
              </div>
            )}

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
                  const nz = nearestZone(m.lat, m.lng, zones, m.id)
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
                        {nz && <div style={{ fontSize: 9, fontWeight: 700, color: nz.inside ? '#00E676' : '#5E8B6E' }}>{nz.inside ? '🛡️ In ' + nz.name : '📍 ' + fmtDist(nz.dist)}</div>}
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
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Family Circle
                {circleId && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={openChildModal}
                      style={{ background: 'rgba(41,182,246,0.1)', border: '1px solid rgba(41,182,246,0.25)', borderRadius: 8, color: '#29B6F6', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      + Add Child
                    </button>
                    <button onClick={() => { setInviteCopied(false); setShowInviteModal(true) }}
                      style={{ background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: 8, color: '#00E676', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      + Invite
                    </button>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#5E8B6E', lineHeight: 1.5 }}>{familyCount}</div>

              {/* Invite code always visible when circle exists */}
              {circleId && circleInviteCode && (
                <div style={{
                  background: '#0D1F13',
                  border: '1.5px solid rgba(0,230,118,0.25)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#5E8B6E', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                      Invite Code — Share with child
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#00E676', letterSpacing: 5, fontFamily: 'monospace' }}>
                      {circleInviteCode}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      try {
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(circleInviteCode).then(() => setInviteCopied(true))
                        } else {
                          const ta = document.createElement('textarea')
                          ta.value = circleInviteCode
                          ta.style.position = 'fixed'; ta.style.opacity = '0'
                          document.body.appendChild(ta); ta.focus(); ta.select()
                          document.execCommand('copy')
                          document.body.removeChild(ta)
                          setInviteCopied(true)
                        }
                        setTimeout(() => setInviteCopied(false), 2000)
                      } catch { setInviteCopied(true) }
                    }}
                    style={{
                      background: inviteCopied ? '#0D7A45' : 'rgba(0,230,118,0.15)',
                      border: '1px solid rgba(0,230,118,0.3)',
                      borderRadius: 10,
                      color: '#00E676',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '8px 14px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'background 0.2s',
                      flexShrink: 0
                    }}
                  >
                    {inviteCopied ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              )}
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
              {!members.length && (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <p style={{ color: '#5E8B6E', fontSize: 13, marginBottom: 16 }}>
                    {circleId ? 'No family members yet. Share your invite code!' : 'No family circle yet. Create or join one.'}
                  </p>
                  <button
                    onClick={() => { setCircleModalTab('create'); setShowCreateCircleModal(true) }}
                    style={{ background: '#00E676', color: '#020C05', border: 'none', borderRadius: 12, padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 8, fontFamily: 'inherit' }}
                  >
                    + Create Circle
                  </button>
                  <button
                    onClick={() => { setCircleModalTab('join'); setShowCreateCircleModal(true) }}
                    style={{ background: 'transparent', color: '#00E676', border: '1px solid rgba(0,230,118,0.3)', borderRadius: 12, padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Join with Code
                  </button>
                </div>
              )}
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
              <button
                className={styles.geoAddBtn}
                onClick={circleId ? openZoneModal : () => showToast('Create a family circle first (Family tab)', 'error')}
                style={{ opacity: circleId ? 1 : 0.5, cursor: circleId ? 'pointer' : 'not-allowed' }}
              >+ Add Zone</button>
            </div>
            <div className={styles.zoneList}>
              {!circleId && (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <p style={{ color: '#5E8B6E', fontSize: 13, marginBottom: 12 }}>No family circle yet.</p>
                  <button
                    onClick={() => setActiveTab('family')}
                    style={{ background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: 10, color: '#00E676', fontSize: 13, fontWeight: 700, padding: '10px 20px', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Go to Family tab to create one
                  </button>
                </div>
              )}
              {circleId && !zones.length && !zoneSubtitle.startsWith('Loading') && (
                <div style={{ textAlign: 'center', color: '#5E8B6E', padding: '40px 20px', fontSize: 13 }}>No safe zones yet — tap + Add Zone</div>
              )}
              {groupZones(zones, members).map((g, gi) => (
                <div key={g.key} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#5E8B6E', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 2px 8px' }}>
                    {g.label} ({g.zones.length})
                  </div>
                  {g.zones.map((z, i) => (
                    <div key={z.id} className={`${styles.zoneCard} ${styles.reveal}`} style={{ transitionDelay: (gi + i) * 0.06 + 's', opacity: z.active ? 1 : 0.6 }}>
                      <div className={styles.zoneTop}>
                        <div className={styles.zoneIconWrap}>📍</div>
                        <div className={styles.zoneInfo}>
                          <div className={styles.zoneName}>{z.name}</div>
                          <div className={styles.zoneAddress}>{z.address}</div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: z.assigned_user_name ? '#29B6F6' : '#5E8B6E', background: z.assigned_user_name ? 'rgba(41,182,246,0.12)' : 'rgba(94,139,110,0.12)', border: '1px solid ' + (z.assigned_user_name ? 'rgba(41,182,246,0.3)' : 'rgba(94,139,110,0.3)'), padding: '2px 7px', borderRadius: 8 }}>
                              {z.assigned_user_name ? '👤 ' + z.assigned_user_name : '👨‍👩‍👧 Shared'}
                            </span>
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#00E676', background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.25)', padding: '2px 7px', borderRadius: 8 }}>
                              {z.category}
                            </span>
                          </div>
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
                          <button className={styles.zoneActionBtn} title="Edit" onClick={() => openEditZone(z)}
                            style={{ marginRight: 4 }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button className={styles.zoneActionBtn} title="Delete" onClick={() => deleteZone(z.id)}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div className={`${styles.addZoneCard} ${styles.reveal}`} style={{ transitionDelay: zones.length * 0.08 + 's', opacity: circleId ? 1 : 0.5, cursor: circleId ? 'pointer' : 'not-allowed' }} onClick={circleId ? openZoneModal : () => showToast('Create a family circle first (Family tab)', 'error')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add New Safe Zone
              </div>
            </div>

          </div>

          {/* TAB 5: SETTINGS */}
          <div className={`${styles.tabSection} ${activeTab === 'settings' ? styles.tabSectionActive : ''}`}>
            <div className={styles.settingsProfile}>
              {/* Avatar upload */}
              <div className={styles.settingsAvatarWrap} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => !avatarUploading && avatarFileInputRef.current?.click()}>
                <img
                  src={userAvatar}
                  alt="Profile"
                  className={styles.settingsAvatar}
                  style={{ width: 80, height: 80, borderRadius: '50%', border: '3px solid #00E676', objectFit: 'cover', display: 'block' }}
                />
                {avatarUploading && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,200,83,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.9s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                  </div>
                )}
                {!avatarUploading && (
                  <div style={{ position: 'absolute', bottom: 2, right: 2, width: 22, height: 22, borderRadius: '50%', background: '#00E676', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#060f0a', fontWeight: 800, boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>✏️</div>
                )}
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleAvatarFileChange}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className={styles.settingsUserName}>{userName}</div>
                <div className={styles.settingsUserEmail}>{userEmail}</div>
              </div>
            </div>

            {/* Profile edit: name field + save */}
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ background: '#0D1F13', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: '#5E8B6E', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>Edit Profile</div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Display Name</div>
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveProfile()}
                  placeholder="Your name"
                  style={{ background: '#0F2416', border: '1px solid rgba(0,230,118,0.2)', color: '#E8F5E9', padding: '10px 14px', borderRadius: 8, width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }}
                />
                <button
                  onClick={saveProfile}
                  disabled={profileSaving}
                  style={{ background: profileSaving ? '#0D7A45' : 'linear-gradient(135deg,#00C853,#00E676)', color: '#060f0a', fontWeight: 700, padding: '10px 20px', border: 'none', borderRadius: 8, cursor: profileSaving ? 'wait' : 'pointer', fontSize: 13, fontFamily: 'inherit' }}
                >
                  {profileSaving ? 'Saving...' : 'Save'}
                </button>
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

              {/* WEEKLY REPORTS */}
              <div className={`${styles.settingsGroup} ${styles.reveal}`} style={{ transitionDelay: '0.18s' }}>
                <div className={styles.settingsGroupHeader}>Weekly Reports</div>
                <div style={{ padding: '4px 14px 14px' }}>
                  <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 6 }}>Select a member</div>
                  <select
                    value={reportMemberId}
                    onChange={(e) => loadWeekly(e.target.value)}
                    style={{ width: '100%', background: '#0F2416', border: '1px solid rgba(0,230,118,0.2)', color: '#E8F5E9', padding: '10px 14px', borderRadius: 8, boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }}
                  >
                    <option value="">— Choose a member —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>

                  {reportLoading && <div style={{ color: '#5E8B6E', fontSize: 12, padding: '8px 0' }}>Loading report…</div>}

                  {!reportLoading && reportMemberId && !weekly && (
                    <div style={{ color: '#5E8B6E', fontSize: 12, padding: '8px 0' }}>No report data for this member yet.</div>
                  )}

                  {!reportLoading && weekly && (
                    <div style={{ background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 12, padding: 12 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#00E676', background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.25)', padding: '4px 8px', borderRadius: 8 }}>
                          {(weekly.totals.totalDistanceMeters / 1000).toFixed(1)} km
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#29B6F6', background: 'rgba(41,182,246,0.1)', border: '1px solid rgba(41,182,246,0.25)', padding: '4px 8px', borderRadius: 8 }}>
                          🏠 {Math.round(weekly.totals.timeAtHomeSec / 3600)} h home
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB300', background: 'rgba(255,179,0,0.1)', border: '1px solid rgba(255,179,0,0.25)', padding: '4px 8px', borderRadius: 8 }}>
                          🏫 {Math.round(weekly.totals.timeAtSchoolSec / 3600)} h school
                        </span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ color: '#5E8B6E', textAlign: 'left' }}>
                            <th style={{ padding: '4px 6px', fontWeight: 700 }}>Date</th>
                            <th style={{ padding: '4px 6px', fontWeight: 700 }}>Dist</th>
                            <th style={{ padding: '4px 6px', fontWeight: 700 }}>Places</th>
                            <th style={{ padding: '4px 6px', fontWeight: 700 }}>Home</th>
                            <th style={{ padding: '4px 6px', fontWeight: 700 }}>School</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weekly.days.map((d) => (
                            <tr key={d.date} style={{ color: '#E8F5E9', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '5px 6px' }}>{d.date.slice(5)}</td>
                              <td style={{ padding: '5px 6px' }}>{(d.distanceMeters / 1000).toFixed(1)}km</td>
                              <td style={{ padding: '5px 6px' }}>{d.placesVisited}</td>
                              <td style={{ padding: '5px 6px' }}>{Math.round(d.timeAtHomeSec / 60)}m</td>
                              <td style={{ padding: '5px 6px' }}>{Math.round(d.timeAtSchoolSec / 60)}m</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        onClick={downloadWeeklyCsv}
                        style={{ marginTop: 12, width: '100%', background: 'linear-gradient(135deg,#00C853,#00E676)', color: '#060f0a', fontWeight: 700, padding: '10px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        ⬇ Download CSV
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* EMERGENCY CONTACTS */}
              <div className={`${styles.settingsGroup} ${styles.reveal}`} style={{ transitionDelay: '0.2s' }}>
                <div className={styles.settingsGroupHeader}>Emergency Contacts</div>
                <div style={{ padding: '4px 14px 14px' }}>
                  <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 10 }}>Also alerted on SOS.</div>
                  {contacts.map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#050C08', border: '1px solid rgba(0,230,118,0.1)', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#E8F5E9' }}>{c.name}{c.relation ? ' · ' + c.relation : ''}</div>
                        {c.phone && <div style={{ fontSize: 11, color: '#5E8B6E' }}>{c.phone}</div>}
                      </div>
                      <button onClick={() => deleteContact(c.id)}
                        style={{ background: 'rgba(255,82,82,0.12)', border: '1px solid rgba(255,82,82,0.3)', color: '#FF5252', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                        Delete
                      </button>
                    </div>
                  ))}
                  {!contacts.length && <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 8 }}>No emergency contacts yet.</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <input placeholder="Name" value={ecName} onChange={(e) => setEcName(e.target.value)}
                      style={{ background: '#0F2416', border: '1px solid rgba(0,230,118,0.2)', color: '#E8F5E9', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input placeholder="Phone" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)}
                        style={{ flex: 1, background: '#0F2416', border: '1px solid rgba(0,230,118,0.2)', color: '#E8F5E9', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                      <input placeholder="Relation" value={ecRelation} onChange={(e) => setEcRelation(e.target.value)}
                        style={{ flex: 1, background: '#0F2416', border: '1px solid rgba(0,230,118,0.2)', color: '#E8F5E9', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                    </div>
                    <button onClick={addContact}
                      style={{ background: 'linear-gradient(135deg,#00C853,#00E676)', color: '#060f0a', fontWeight: 700, padding: '10px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                      + Add Contact
                    </button>
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

      {/* Share Invite Code Modal */}
      {showInviteModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0D1F13', border: '1px solid rgba(0,230,118,0.15)', borderRadius: 18, padding: 24, width: 'calc(100% - 48px)', maxWidth: 320 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Invite Family Member</div>
            <div style={{ fontSize: 12, color: '#5E8B6E', marginBottom: 20 }}>Share this code with your family member to join your circle.</div>
            <div style={{ background: '#050C08', border: '1px solid rgba(0,230,118,0.2)', borderRadius: 12, padding: '16px 20px', textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Invite Code</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#00E676', letterSpacing: 6, fontFamily: 'monospace' }}>{circleInviteCode}</div>
            </div>
            <button
              onClick={() => {
                try {
                  if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(circleInviteCode).then(() => setInviteCopied(true))
                  } else {
                    const ta = document.createElement('textarea')
                    ta.value = circleInviteCode
                    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
                    document.body.appendChild(ta)
                    ta.focus(); ta.select()
                    document.execCommand('copy')
                    document.body.removeChild(ta)
                    setInviteCopied(true)
                  }
                } catch { setInviteCopied(true) }
              }}
              style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: inviteCopied ? '#0D7A45' : '#00E676', color: '#020C05', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10, transition: 'background 0.2s' }}
            >
              {inviteCopied ? '✓ Copied!' : 'Copy Code'}
            </button>
            <button
              onClick={() => setShowInviteModal(false)}
              style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: '1px solid rgba(0,230,118,0.15)', background: 'transparent', color: '#5E8B6E', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Create/Join Circle Modal */}
      {showCreateCircleModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0D1F13', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 18, padding: 24, width: 'calc(100% - 48px)', maxWidth: 340 }}>
            <div style={{ display: 'flex', marginBottom: 20, background: '#050C08', borderRadius: 10, padding: 4 }}>
              {(['create', 'join'] as const).map(t => (
                <button key={t} onClick={() => setCircleModalTab(t)}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: circleModalTab === t ? 'rgba(0,230,118,0.15)' : 'transparent', color: circleModalTab === t ? '#00E676' : '#5E8B6E', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {t === 'create' ? 'Create New' : 'Join with Code'}
                </button>
              ))}
            </div>
            {circleModalTab === 'create' ? (
              <>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Circle Name</div>
                <input
                  style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16 }}
                  placeholder="e.g. Family, My Home"
                  value={newCircleName}
                  onChange={e => setNewCircleName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createCircle()}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowCreateCircleModal(false)}
                    style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,230,118,0.12)', background: 'transparent', color: '#5E8B6E', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button onClick={createCircle} disabled={circleModalLoading}
                    style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: circleModalLoading ? '#0D7A45' : '#00E676', color: '#020C05', fontSize: 13, fontWeight: 700, cursor: circleModalLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {circleModalLoading ? 'Creating...' : 'Create Circle'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Invite Code</div>
                <input
                  style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 2 }}
                  placeholder="e.g. A1B2C3"
                  value={inviteCodeInput}
                  onChange={e => setInviteCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && joinCircle()}
                  maxLength={12}
                />
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 16 }}>Ask the circle admin for their invite code.</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowCreateCircleModal(false)}
                    style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,230,118,0.12)', background: 'transparent', color: '#5E8B6E', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button onClick={joinCircle} disabled={circleModalLoading}
                    style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: circleModalLoading ? '#0D7A45' : '#00E676', color: '#020C05', fontSize: 13, fontWeight: 700, cursor: circleModalLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {circleModalLoading ? 'Joining...' : 'Join Circle'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit Zone Modal */}
      {showEditZoneModal && editingZone && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0D1F13', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 18, padding: 24, width: 'calc(100% - 48px)', maxWidth: 360, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 16 }}>Edit Safe Zone</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Zone Name</div>
                <input style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  type="text" placeholder="e.g. Home, School" value={ezName} onChange={e => setEzName(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Latitude</div>
                  <input style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    type="number" step="any" value={ezLat} onChange={e => setEzLat(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Longitude</div>
                  <input style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    type="number" step="any" value={ezLng} onChange={e => setEzLng(e.target.value)} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Radius (meters)</div>
                <input style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  type="number" min="50" max="5000" value={ezRadius} onChange={e => setEzRadius(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Assign to</div>
                  <select style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    value={ezAssigned} onChange={e => setEzAssigned(e.target.value)}>
                    <option value="">Everyone (shared)</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Category</div>
                  <select style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    value={ezCategory} onChange={e => setEzCategory(e.target.value)}>
                    {ZONE_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => { setShowEditZoneModal(false); setEditingZone(null) }}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,230,118,0.12)', background: 'transparent', color: '#5E8B6E', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={updateZone}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#00E676', color: '#020C05', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Child Modal */}
      {showChildModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0D1F13', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 18, padding: 24, width: 'calc(100% - 48px)', maxWidth: 340 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 16 }}>Add Child</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Child Name</div>
                <input style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  type="text" placeholder="e.g. Aanya" value={childName} onChange={e => setChildName(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Date of Birth (optional)</div>
                <input style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  type="date" value={childDob} onChange={e => setChildDob(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#5E8B6E', marginBottom: 4 }}>Circle (you must be admin)</div>
                <select style={{ width: '100%', background: '#050C08', border: '1px solid rgba(0,230,118,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  value={childCircleId} onChange={e => setChildCircleId(e.target.value)}>
                  {!allCircles.length && <option value="">No circles available</option>}
                  {allCircles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowChildModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid rgba(0,230,118,0.12)', background: 'transparent', color: '#5E8B6E', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={addChild} disabled={childSaving}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: childSaving ? '#0D7A45' : '#00E676', color: '#020C05', fontSize: 13, fontWeight: 700, cursor: childSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                {childSaving ? 'Adding...' : 'Add Child'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Zone Modal — outside appFrame to avoid overflow:hidden clipping */}
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
              <div className={styles.modalRow}>
                <div className={styles.modalHalf}>
                  <div className={styles.modalFieldLabel}>Assign to</div>
                  <select className={styles.modalInput} value={znAssigned} onChange={(e) => setZnAssigned(e.target.value)}>
                    <option value="">Everyone (shared)</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className={styles.modalHalf}>
                  <div className={styles.modalFieldLabel}>Category</div>
                  <select className={styles.modalInput} value={znCategory} onChange={(e) => setZnCategory(e.target.value)}>
                    {ZONE_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
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
  )
}
