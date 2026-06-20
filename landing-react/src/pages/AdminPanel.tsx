import styles from './AdminPanel.module.css'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const API = window.location.origin + '/api/v1/admin'

/* ════════════════════════════════════════════════════════════
   INTERFACES
   ════════════════════════════════════════════════════════════ */
interface DashboardStats {
  totalUsers: number
  parents: number
  children: number
  banned: number
  totalCircles: number
  activeUsers: number
  sosToday: number
  geofenceEvents: number
  locationPoints: number
}

interface User {
  id: string
  name: string
  phone: string
  email: string
  account_type: 'parent' | 'child'
  circle_count: number
  created_at: string
  is_banned: boolean
  avatar_url?: string
}

interface Circle {
  id: string
  name: string
  invite_code: string
  created_at: string
  owner_name: string
  owner_phone: string
  member_count: number
  zone_count: number
}

interface SosEvent {
  id: string
  user_id?: string
  user_name: string
  circle_id?: string
  latitude: number
  longitude: number
  message: string
  resolved: boolean
  created_at: string
  user_phone: string
}

interface GeofenceEvent {
  id: string
  event_type: 'entry' | 'exit'
  created_at: string
  user_name: string
  phone: string
  zone_name: string
  circle_name: string
}

interface OtpRecord {
  phone: string
  code: string
  expires_at: string
  used: boolean
  created_at: string
}

interface SmsDebugStats {
  todaySent: number
  todayDelivered: number
  failed: number
  deliveryRate: number
}

interface TableStat {
  name: string
  rows: number
}

interface RateLimit {
  max?: number
  windowMs?: number
}

interface SystemData {
  dbSize?: string
  tables?: TableStat[]
  rateLimit?: RateLimit
  nodeVersion?: string
  uptime?: number
  connectedClients?: number
}

interface BroadcastRecord {
  id: string
  message: string
  type: 'info' | 'warning' | 'alert'
  recipients: number
  sentAt: string
}

type TabKey = 'dashboard' | 'users' | 'circles' | 'sos' | 'logs' | 'system' | 'broadcast'

/* ════════════════════════════════════════════════════════════
   HELPER FUNCTIONS (module level)
   ════════════════════════════════════════════════════════════ */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'K'
  return String(n)
}

function fmtRelTime(str: string): string {
  const diff = Date.now() - new Date(str).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDate(str: string | null | undefined): string {
  if (!str) return '—'
  const d = new Date(str)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

function formatRelativeOtp(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const m = Math.floor(diff / 60000)
  if (m < 1) return `${Math.floor(diff / 1000)}s`
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

function formatGeofenceTime(str: string | null | undefined): string {
  if (!str) return '—'
  return fmtRelTime(str)
}

function getOtpStatus(otp: OtpRecord): 'used' | 'active' | 'expired' {
  if (otp.used) return 'used'
  if (new Date(otp.expires_at).getTime() < Date.now()) return 'expired'
  return 'active'
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now()
}

function timeAgo(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function getInitials(name: string): string {
  return (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('') || '?'
}

function getAvatarColor(name: string): string {
  const colors = ['#1B5E20', '#004D40', '#0D47A1', '#4A148C', '#B71C1C', '#E65100', '#1A237E']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function getCircleIconStyle(index: number): { bg: string; emoji: string } {
  const arr = [
    { bg: '#1B5E20', emoji: '👨‍👩‍👦' },
    { bg: '#0D47A1', emoji: '🏠' },
    { bg: '#4A148C', emoji: '🏫' },
    { bg: '#E65100', emoji: '🏃' },
    { bg: '#00695C', emoji: '⭐' },
  ]
  return arr[index % arr.length]
}

function getZoneIcon(zoneName: string): { emoji: string; bg: string } {
  const lower = (zoneName || '').toLowerCase()
  if (lower.includes('home') || lower.includes('house'))
    return { emoji: '🏠', bg: 'rgba(0,230,118,0.15)' }
  if (lower.includes('school') || lower.includes('college') || lower.includes('uni'))
    return { emoji: '🏫', bg: 'rgba(41,182,246,0.15)' }
  if (lower.includes('gym') || lower.includes('sport') || lower.includes('fitness'))
    return { emoji: '🏋️', bg: 'rgba(255,179,0,0.15)' }
  if (lower.includes('office') || lower.includes('work') || lower.includes('shop'))
    return { emoji: '🏪', bg: 'rgba(171,71,188,0.15)' }
  return { emoji: '📍', bg: 'rgba(0,230,118,0.1)' }
}

/* ── Count-up hook ── */
function useCountUp(target: number, duration = 1000): number {
  const [val, setVal] = useState(0)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!target) { setVal(0); return }
    const start = performance.now()
    function step(now: number) {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(eased * target))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])
  return val
}

/* ── Status bar clock ── */
function useClock(): string {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  )
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }))
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

/* ── Animated dashboard stat card ── */
function DashStatCard({
  emoji, label, rawValue, color, bgColor, borderColor,
}: {
  emoji: string
  label: string
  rawValue: number
  color: string
  bgColor: string
  borderColor: string
}) {
  const animated = useCountUp(rawValue)
  return (
    <div
      className={styles.statCard}
      style={{ border: `1px solid ${borderColor}` }}
    >
      <div
        className={styles.statGlow}
        style={{ background: `radial-gradient(circle, ${bgColor} 0%, transparent 70%)` }}
      />
      <span style={{ fontSize: 18, lineHeight: 1 }}>{emoji}</span>
      <span className={styles.statValue} style={{ color }}>{fmtNum(animated)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════ */
export default function AdminPanel() {
  const navigate = useNavigate()
  const clock = useClock()
  const adminToken = typeof localStorage !== 'undefined' ? (localStorage.getItem('admin_token') || '') : ''

  /* ── View mode (desktop / mobile) ── */
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>(() =>
    (localStorage.getItem('admin_view_mode') as 'mobile' | 'desktop') || 'desktop'
  )
  const toggleViewMode = () => {
    const next = viewMode === 'mobile' ? 'desktop' : 'mobile'
    setViewMode(next)
    localStorage.setItem('admin_view_mode', next)
  }

  /* ── Global UI state ── */
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  /* ── Dashboard ── */
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null)
  const [recentSos, setRecentSos] = useState<SosEvent[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(false)

  /* ── Users ── */
  const [users, setUsers] = useState<User[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [usersSearch, setUsersSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState("all")
  const [userStatusFilter, setUserStatusFilter] = useState("all")
  const [showUserFilter, setShowUserFilter] = useState(false)
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── Circles ── */
  const [circles, setCircles] = useState<Circle[]>([])
  const [circlesSearch, setCirclesSearch] = useState('')
  const [circlesLoading, setCirclesLoading] = useState(false)
  const [selectedCircle, setSelectedCircle] = useState<Circle | null>(null)
  const [circleMenuOpen, setCircleMenuOpen] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [showCreateCircle, setShowCreateCircle] = useState(false)
  const [newCircleName, setNewCircleName] = useState("")
  const [newCirclePhone, setNewCirclePhone] = useState("")
  const [creating, setCreating] = useState(false)

  /* ── SOS ── */
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([])
  const [sosSearch, setSosSearch] = useState('')
  const [sosLoading, setSosLoading] = useState(false)
  const [selectedSos, setSelectedSos] = useState<string[]>([])
  const [sosFilter, setSosFilter] = useState<'all' | 'new' | 'resolved'>('all')

  /* ── Logs ── */
  const [logsSubTab, setLogsSubTab] = useState<'geofence' | 'otp'>('geofence')
  const [geoEvents, setGeoEvents] = useState<GeofenceEvent[]>([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoFilter, setGeoFilter] = useState<'all' | 'entry' | 'exit'>('all')
  const [geoPage, setGeoPage] = useState(12)
  const [otps, setOtps] = useState<OtpRecord[]>([])
  const [otpsLoading, setOtpsLoading] = useState(false)
  const [otpSearch, setOtpSearch] = useState('')

  /* ── System ── */
  const [sysData, setSysData] = useState<SystemData | null>(null)
  const [sysLoading, setSysLoading] = useState(false)
  const [purgeDays, setPurgeDays] = useState(30)
  const [purgeLoading, setPurgeLoading] = useState(false)
  const [purgeResult, setPurgeResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [purgeConfirm, setPurgeConfirm] = useState(false)

  /* ── Broadcast ── */
  const [bMessage, setBMessage] = useState('')
  const [bType, setBType] = useState<'info' | 'warning' | 'alert'>('info')
  const [bLoading, setBLoading] = useState(false)
  const [bResult, setBResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [recentBroadcasts, setRecentBroadcasts] = useState<BroadcastRecord[]>([])

  /* ════════════════════════════════════════════════════════════
     CORE: toast + api
     ════════════════════════════════════════════════════════════ */
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const handle401 = useCallback(() => {
    localStorage.removeItem('admin_token')
    navigate('/admin/login')
  }, [navigate])

  const apiCall = useCallback(async (
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<any | null> => {
    try {
      const token = localStorage.getItem('admin_token') || ''
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          'x-admin-token': token,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (res.status === 401) { handle401(); return null }
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }, [handle401])

  /* ════════════════════════════════════════════════════════════
     DASHBOARD
     ════════════════════════════════════════════════════════════ */
  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true)
    const [dashData, sosData] = await Promise.all([apiCall('/dashboard'), apiCall('/sos')])
    if (dashData?.stats) setDashboardStats(dashData.stats)
    if (sosData?.sos_events) setRecentSos((sosData.sos_events as SosEvent[]).slice(0, 3))
    setDashboardLoading(false)
  }, [apiCall])

  /* ════════════════════════════════════════════════════════════
     USERS
     ════════════════════════════════════════════════════════════ */
  const loadUsers = useCallback(async (page: number = 1, search: string = '') => {
    setUsersLoading(true)
    const data = await apiCall(`/users?page=${page}&search=${encodeURIComponent(search)}&role=${userRoleFilter}&status=${userStatusFilter}&limit=20`)
    if (data) {
      if (page === 1) setUsers(data.users || [])
      else setUsers(prev => [...prev, ...(data.users || [])])
      setUsersTotal(data.total || 0)
      setUsersPage(page)
    } else {
      showToast('Failed to load users', 'error')
    }
    setUsersLoading(false)
  }, [apiCall, showToast])

  const handleSearchChange = (value: string) => {
    setUsersSearch(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => loadUsers(1, value), 300)
  }

  const handleBan = async (userId: string, expectBanned: boolean) => {
    setActionLoading(true)
    const data = await apiCall(`/users/${userId}/ban`, 'PATCH')
    if (data?.user) {
      const banned = data.user.is_banned
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_banned: banned } : u))
      if (selectedUser?.id === userId) setSelectedUser(prev => prev ? { ...prev, is_banned: banned } : null)
      showToast(`${data.user.name || 'User'} ${banned ? 'banned' : 'unbanned'}`, 'success')
    } else {
      showToast(`Failed to ${expectBanned ? 'ban' : 'unban'} user`, 'error')
    }
    setActionLoading(false)
  }

  const handleDelete = async (userId: string) => {
    if (confirmDelete !== userId) { setConfirmDelete(userId); return }
    setActionLoading(true)
    const data = await apiCall(`/users/${userId}`, 'DELETE')
    if (data) {
      setUsers(prev => prev.filter(u => u.id !== userId))
      setUsersTotal(prev => prev - 1)
      if (selectedUser?.id === userId) setSelectedUser(null)
      setConfirmDelete(null)
      showToast(`${data.deleted?.name || 'User'} deleted`, 'success')
    } else {
      showToast('Failed to delete user', 'error')
    }
    setActionLoading(false)
  }

  /* ════════════════════════════════════════════════════════════
     CIRCLES
     ════════════════════════════════════════════════════════════ */
  const loadCircles = useCallback(async () => {
    setCirclesLoading(true)
    const data = await apiCall('/circles')
    if (data) setCircles(data.circles || [])
    setCirclesLoading(false)
  }, [apiCall])

  const handleDeleteCircle = async (id: string) => {
    if (!window.confirm('Delete this circle? This cannot be undone.')) return
    const data = await apiCall(`/circles/${id}`, 'DELETE')
    if (data) {
      setCircles(prev => prev.filter(c => c.id !== id))
      setCircleMenuOpen(null)
      if (selectedCircle?.id === id) setSelectedCircle(null)
      showToast('Circle deleted', 'success')
    } else {
      showToast('Failed to delete circle', 'error')
    }
  }

  const handleRegenInvite = async (id: string) => {
    const data = await apiCall(`/circles/${id}/invite`, 'PATCH')
    if (data?.circle) {
      setCircles(prev => prev.map(c => c.id === id ? { ...c, invite_code: data.circle.invite_code } : c))
      setCircleMenuOpen(null)
      showToast('Invite code regenerated', 'success')
    } else {
      showToast('Failed to regenerate code', 'error')
    }
  }

  const handleCreateCircle = async () => {
    if (!newCircleName.trim() || !newCirclePhone.trim()) return
    setCreating(true)
    const data = await apiCall("/circles", "POST", { name: newCircleName, ownerPhone: newCirclePhone })
    if (data?.circle) { showToast("Circle created!", "success"); setShowCreateCircle(false); setNewCircleName(""); setNewCirclePhone(""); loadCircles() }
    else showToast("Failed — check phone number", "error")
    setCreating(false)
  }

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code)
      showToast('Copied!', 'success')
      setTimeout(() => setCopiedCode(null), 2000)
    }).catch(() => showToast('Copy failed', 'error'))
  }

  const filteredCircles = circles.filter(c =>
    c.name.toLowerCase().includes(circlesSearch.toLowerCase()) ||
    (c.owner_name || '').toLowerCase().includes(circlesSearch.toLowerCase()) ||
    (c.invite_code || '').toLowerCase().includes(circlesSearch.toLowerCase())
  )

  /* ════════════════════════════════════════════════════════════
     SOS
     ════════════════════════════════════════════════════════════ */
  const loadSos = useCallback(async () => {
    setSosLoading(true)
    const data = await apiCall('/sos')
    if (data) setSosEvents(data.sos_events || [])
    setSosLoading(false)
  }, [apiCall])

  const handleResolve = async (id: string) => {
    const data = await apiCall(`/sos/${id}/resolve`, 'PATCH')
    if (data) {
      setSosEvents(prev => prev.map(e => e.id === id ? { ...e, resolved: true } : e))
      setSelectedSos(prev => prev.filter(sid => sid !== id))
    }
  }

  const handleResolveSelected = async () => {
    await Promise.all(selectedSos.map(id => handleResolve(id)))
    showToast('Resolved', 'success')
  }

  const handleDismissSelected = () => {
    setSosEvents(prev => prev.filter(e => !selectedSos.includes(e.id)))
    setSelectedSos([])
  }

  const toggleSelectSos = (id: string) => {
    setSelectedSos(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id])
  }

  const formatCoords = (lat: number, lng: number): string =>
    `${(lat ?? 0).toFixed(5)}, ${(lng ?? 0).toFixed(5)}`

  const filteredSos = sosEvents.filter(e => {
    const matchesSearch =
      sosSearch === '' ||
      (e.user_name || '').toLowerCase().includes(sosSearch.toLowerCase()) ||
      (e.message || '').toLowerCase().includes(sosSearch.toLowerCase()) ||
      (e.user_phone || '').includes(sosSearch)
    const matchesFilter =
      sosFilter === 'all' ||
      (sosFilter === 'new' && !e.resolved) ||
      (sosFilter === 'resolved' && e.resolved)
    return matchesSearch && matchesFilter
  })

  const unresolvedCount = sosEvents.filter(e => !e.resolved).length

  /* ════════════════════════════════════════════════════════════
     LOGS
     ════════════════════════════════════════════════════════════ */
  const fetchGeofences = useCallback(async () => {
    setGeoLoading(true)
    const data = await apiCall('/geofences')
    if (data) setGeoEvents(data.events || [])
    setGeoLoading(false)
  }, [apiCall])

  const fetchOtps = useCallback(async () => {
    setOtpsLoading(true)
    const data = await apiCall('/otps')
    if (data) setOtps(data.otps || [])
    setOtpsLoading(false)
  }, [apiCall])

  const getFilteredGeoEvents = (): GeofenceEvent[] => {
    if (geoFilter === 'all') return geoEvents
    return geoEvents.filter(e => e.event_type === geoFilter)
  }

  const getFilteredOtps = (): OtpRecord[] => {
    if (!otpSearch.trim()) return otps
    return otps.filter(o => o.phone.includes(otpSearch.trim()))
  }

  const computeSmsDebugStats = (): SmsDebugStats => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayOtps = otps.filter(o => new Date(o.created_at).getTime() >= todayStart.getTime())
    const todaySent = todayOtps.length
    const todayDelivered = todayOtps.filter(o => o.used).length
    const failed = todayOtps.filter(o => !o.used && new Date(o.expires_at).getTime() < Date.now()).length
    const deliveryRate = todaySent > 0 ? Math.round((todayDelivered / todaySent) * 100) : 0
    return { todaySent, todayDelivered, failed, deliveryRate }
  }

  /* ════════════════════════════════════════════════════════════
     SYSTEM
     ════════════════════════════════════════════════════════════ */
  const fetchSystem = useCallback(async () => {
    setSysLoading(true)
    const data = await apiCall('/system')
    if (data) setSysData(data)
    setSysLoading(false)
  }, [apiCall])

  async function handlePurge() {
    if (!purgeConfirm) { setPurgeConfirm(true); return }
    setPurgeConfirm(false)
    setPurgeLoading(true)
    setPurgeResult(null)
    const data = await apiCall(`/locations/purge?days=${purgeDays}`, 'DELETE')
    setPurgeLoading(false)
    if (data !== null) {
      const deleted = (data.deleted ?? data.rows ?? 0) as number
      setPurgeResult({ ok: true, text: `Purged ${deleted.toLocaleString()} location records older than ${purgeDays} days.` })
      showToast('Purge complete', 'success')
      fetchSystem()
    } else {
      setPurgeResult({ ok: false, text: 'Purge failed. Check server logs.' })
      showToast('Purge failed', 'error')
    }
  }

  /* ════════════════════════════════════════════════════════════
     BROADCAST
     ════════════════════════════════════════════════════════════ */
  async function handleBroadcast() {
    if (!bMessage.trim()) { showToast('Please enter a message', 'error'); return }
    setBLoading(true)
    setBResult(null)
    const data = await apiCall('/broadcast', 'POST', { message: bMessage.trim(), type: bType })
    setBLoading(false)
    if (data !== null) {
      const recipients = (data.recipients ?? 0) as number
      const record: BroadcastRecord = {
        id: Date.now().toString(),
        message: bMessage.trim(),
        type: bType,
        recipients,
        sentAt: new Date().toISOString(),
      }
      setRecentBroadcasts(prev => [record, ...prev].slice(0, 20))
      setBResult({ ok: true, text: `Broadcast sent to ${recipients} connected user${recipients !== 1 ? 's' : ''}.` })
      showToast('Broadcast sent!', 'success')
      setBMessage('')
    } else {
      setBResult({ ok: false, text: 'Failed to send broadcast. Check server logs.' })
      showToast('Broadcast failed', 'error')
    }
  }

  /* ════════════════════════════════════════════════════════════
     EFFECTS
     ════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!adminToken) {
      navigate('/admin/login')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    switch (activeTab) {
      case 'dashboard': loadDashboard(); break
      case 'users': loadUsers(1, usersSearch); break
      case 'circles': loadCircles(); break
      case 'sos': loadSos(); break
      case 'logs': fetchGeofences(); fetchOtps(); break
      case 'system': fetchSystem(); break
      case 'broadcast': fetchSystem(); break
      default: break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  /* ════════════════════════════════════════════════════════════
     METADATA
     ════════════════════════════════════════════════════════════ */
  const sectionTitles: Record<TabKey, string> = {
    dashboard: 'Dashboard',
    users: 'User Management',
    circles: 'Circle Management',
    sos: 'SOS Monitoring',
    logs: 'Activity Logs',
    system: 'System Info',
    broadcast: 'Broadcast Center',
  }

  const navItems: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'users', label: 'Users', icon: '👥' },
    { key: 'circles', label: 'Circles', icon: '🔗' },
    { key: 'sos', label: 'SOS', icon: '🆘' },
    { key: 'logs', label: 'Logs', icon: '📜' },
    { key: 'system', label: 'System', icon: '⚙️' },
    { key: 'broadcast', label: 'Broadcast', icon: '📡' },
  ]

  const dashStatGrid: Array<{
    emoji: string; label: string; key: keyof DashboardStats
    color: string; bgColor: string; borderColor: string
  }> = [
    { emoji: '👥', label: 'Total Users', key: 'totalUsers', color: '#00E676', bgColor: 'rgba(0,230,118,0.18)', borderColor: 'rgba(0,230,118,0.18)' },
    { emoji: '👨', label: 'Parents', key: 'parents', color: '#00E676', bgColor: 'rgba(0,230,118,0.18)', borderColor: 'rgba(0,230,118,0.18)' },
    { emoji: '🧒', label: 'Children', key: 'children', color: '#00E676', bgColor: 'rgba(0,230,118,0.18)', borderColor: 'rgba(0,230,118,0.18)' },
    { emoji: '🚫', label: 'Banned', key: 'banned', color: '#FF5252', bgColor: 'rgba(255,82,82,0.18)', borderColor: 'rgba(255,82,82,0.18)' },
    { emoji: '🔗', label: 'Circles', key: 'totalCircles', color: '#AB47BC', bgColor: 'rgba(171,71,188,0.18)', borderColor: 'rgba(171,71,188,0.18)' },
    { emoji: '🟢', label: 'Active Users', key: 'activeUsers', color: '#00E676', bgColor: 'rgba(0,230,118,0.18)', borderColor: 'rgba(0,230,118,0.18)' },
    { emoji: '🆘', label: 'SOS Today', key: 'sosToday', color: '#FF5252', bgColor: 'rgba(255,82,82,0.18)', borderColor: 'rgba(255,82,82,0.18)' },
    { emoji: '📍', label: 'Geo Events', key: 'geofenceEvents', color: '#FFB300', bgColor: 'rgba(255,179,0,0.18)', borderColor: 'rgba(255,179,0,0.18)' },
    { emoji: '📡', label: 'Location Pts', key: 'locationPoints', color: '#29B6F6', bgColor: 'rgba(41,182,246,0.18)', borderColor: 'rgba(41,182,246,0.18)' },
  ]

  const typeConfig: Record<'info' | 'warning' | 'alert', { label: string; icon: string; color: string; bg: string; border: string }> = {
    info: { label: 'System Message', icon: '🟢', color: '#00E676', bg: 'rgba(0,230,118,0.10)', border: 'rgba(0,230,118,0.35)' },
    warning: { label: 'Warning Message', icon: '⚠️', color: '#FFB300', bg: 'rgba(255,179,0,0.10)', border: 'rgba(255,179,0,0.35)' },
    alert: { label: 'Alert Message', icon: '🔴', color: '#FF5252', bg: 'rgba(255,82,82,0.10)', border: 'rgba(255,82,82,0.35)' },
  }

  const smsStats = computeSmsDebugStats()
  const filteredGeo = getFilteredGeoEvents()
  const visibleGeo = filteredGeo.slice(0, geoPage)
  const hasMoreGeo = filteredGeo.length > geoPage
  const filteredOtps = getFilteredOtps()
  const totalRows = sysData?.tables?.reduce((sum, t) => sum + (t.rows ?? 0), 0) ?? 0
  const charCount = bMessage.length
  const MAX_CHARS = 500

  /* ════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════ */
  return (
    <div className={`${styles.pageWrapper} ${viewMode === 'desktop' ? styles.desktopMode : ''}`}>

      {/* ── SIDEBAR (desktop only) ── */}
      {viewMode === 'desktop' && (
        <nav className={styles.sidebar}>
          <div className={styles.sidebarLogo}>
            <div className={styles.sidebarLogoTitle}>GRAVITY</div>
            <div className={styles.sidebarLogoSub}>Admin Console</div>
          </div>
          <div className={styles.sidebarNav}>
            {navItems.map(item => (
              <div
                key={item.key}
                className={`${styles.sidebarNavItem} ${activeTab === item.key ? styles.sidebarNavItemActive : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                <span className={styles.sidebarNavIcon}>{item.icon}</span>
                <span className={styles.sidebarNavLabel}>{item.label}</span>
                {item.key === 'sos' && unresolvedCount > 0 && (
                  <span className={styles.sidebarNavBadge}>{unresolvedCount}</span>
                )}
              </div>
            ))}
          </div>
          <div className={styles.sidebarFooter}>
            <button className={styles.toggleViewBtn} onClick={toggleViewMode}>📱 Mobile View</button>
            <button
              className={styles.sidebarSignOut}
              onClick={() => { localStorage.removeItem('admin_token'); navigate('/admin/login') }}
            >
              🚪 Sign Out
            </button>
          </div>
        </nav>
      )}

      <div className={styles.appFrame}>

        {/* ── STATUS BAR ── */}
        <div className={styles.statusBar}>
          <span className={styles.statusBarTime}>{clock}</span>
          <div className={styles.statusIcons}>
            <div className={styles.signalBars}><span /><span /><span /><span /></div>
            <span className={styles.wifiIcon}>📶</span>
            <div className={styles.batteryShell}><div className={styles.batteryFill} /></div>
          </div>
        </div>

        {/* ── DESKTOP HEADER ── */}
        {viewMode === 'desktop' && (
          <div className={styles.desktopHeader}>
            <span className={styles.desktopHeaderTitle}>{sectionTitles[activeTab]}</span>
            <div className={styles.desktopHeaderActions}>
              <button className={styles.toggleViewBtn} onClick={toggleViewMode}>📱 Mobile</button>
              <span style={{ fontSize: 22, position: 'relative', cursor: 'pointer' }}>
                {unresolvedCount > 0 ? '🔔' : '🔕'}
                {unresolvedCount > 0 && <span className={styles.bellDot} style={{ top: 0, right: 0 }} />}
              </span>
            </div>
          </div>
        )}

        {/* ── HEADER (mobile) ── */}
        <div className={styles.appHeader}>
          <div className={styles.headerTitle}>{sectionTitles[activeTab]}</div>
          <button className={styles.iconBtn} aria-label="Notifications">
            <span style={{ fontSize: 18 }}>🔔</span>
            {unresolvedCount > 0 && <span className={styles.bellDot} />}
          </button>
        </div>

        {/* ── TOAST ── */}
        {toast && (
          <div
            className={styles.toast}
            style={{
              background: toast.type === 'success' ? '#00E676' : '#FF5252',
              color: toast.type === 'success' ? '#050C08' : '#fff',
              boxShadow: `0 4px 24px ${toast.type === 'success' ? 'rgba(0,230,118,0.4)' : 'rgba(255,82,82,0.4)'}`,
            }}
          >
            {toast.type === 'success' ? '✓ ' : '✕ '}{toast.message}
          </div>
        )}

        {/* ── FRAME BODY: mini sidebar + scrollable content ── */}
        <div className={styles.frameBody}>

          {/* Mini sidebar — always visible in mobile mode */}
          {viewMode !== 'desktop' && (
            <nav className={styles.miniSidebar}>
              <div className={styles.miniLogo}>🛡</div>
              {navItems.map(item => (
                <button
                  key={item.key}
                  className={`${styles.miniNavBtn} ${activeTab === item.key ? styles.miniNavBtnActive : ''}`}
                  onClick={() => setActiveTab(item.key)}
                  title={item.label}
                >
                  <span className={styles.miniNavIcon}>{item.icon}</span>
                  {item.key === 'sos' && unresolvedCount > 0 && <span className={styles.miniBadge} />}
                </button>
              ))}
              <div className={styles.miniSpacer} />
              <button
                className={styles.miniSignOutBtn}
                onClick={() => { localStorage.removeItem('admin_token'); navigate('/admin/login') }}
                title="Sign Out"
              >🚪</button>
            </nav>
          )}

          <div className={styles.frameMain}>
            {/* ── TAB CONTENT ── */}
            <div className={styles.tabContent}>

          {/* ════════ DASHBOARD ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'dashboard' ? styles.active : ''}`}>
            <div style={{ paddingBottom: 16 }}>
              <div className={styles.sectionTitle}>
                <span className={styles.titleBar} style={{ background: '#00E676', boxShadow: '0 0 8px rgba(0,230,118,0.6)' }} />
                System Overview
              </div>

              {dashboardLoading && !dashboardStats ? (
                <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className={styles.skeleton} style={{ height: 80, borderRadius: 14, animationDelay: `${i * 0.06}s` }} />
                  ))}
                </div>
              ) : (
                <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {dashStatGrid.map(item => (
                    <DashStatCard
                      key={item.key}
                      emoji={item.emoji}
                      label={item.label}
                      rawValue={dashboardStats?.[item.key] ?? 0}
                      color={item.color}
                      bgColor={item.bgColor}
                      borderColor={item.borderColor}
                    />
                  ))}
                </div>
              )}

              <div style={{ padding: '20px 16px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div className={styles.sectionTitle} style={{ padding: 0 }}>
                    <span className={styles.titleBar} style={{ background: '#FF5252', boxShadow: '0 0 8px rgba(255,82,82,0.5)' }} />
                    Recent SOS Alerts
                  </div>
                  <button className={styles.linkBtn} onClick={() => setActiveTab('sos')}>View all →</button>
                </div>

                {dashboardLoading && recentSos.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[0, 1, 2].map(i => <div key={i} className={styles.skeleton} style={{ height: 72, borderRadius: 14, animationDelay: `${i * 0.08}s` }} />)}
                  </div>
                ) : recentSos.length === 0 ? (
                  <div className={styles.emptyCard}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    No active SOS alerts
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recentSos.map((sos, idx) => (
                      <div key={sos.id} className={styles.sosMiniCard} style={{ animationDelay: `${idx * 0.07}s` }} onClick={() => setActiveTab('sos')}>
                        <div className={`${styles.sosBadge} ${!sos.resolved ? styles.sosBadgePulse : ''}`}><span>SOS</span></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.sosMiniName}>{sos.user_name || 'Unknown User'}</div>
                          <div className={styles.sosMiniSub}>
                            {sos.message || (sos.latitude && sos.longitude ? `${sos.latitude.toFixed(4)}, ${sos.longitude.toFixed(4)}` : 'No location data')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                          <span style={{ fontSize: 10, color: '#5E8B6E', whiteSpace: 'nowrap' }}>{fmtRelTime(sos.created_at)}</span>
                          {sos.resolved ? <span className={styles.badgeGreen}>Resolved</span> : <span className={`${styles.badgeRed} ${styles.sosBadgePulse}`}>New</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ════════ USERS ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'users' ? styles.active : ''}`}>
            <div style={{ position: 'relative' }}>
              <div style={{ padding: '16px 16px 8px' }}>
                <div className={styles.sectionLabel}>USER MANAGEMENT</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#E8F5E9' }}>All Users</div>
                  <div className={styles.countPill}>{usersTotal.toLocaleString()} total</div>
                </div>
              </div>

              <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
                <div className={styles.searchBar}>
                  <span style={{ fontSize: 16, color: '#5E8B6E' }}>🔍</span>
                  <input type="text" placeholder="Search users by name or phone..." value={usersSearch} onChange={e => handleSearchChange(e.target.value)} className={styles.searchInput} />
                  {usersSearch && <button onClick={() => { setUsersSearch(''); loadUsers(1, '') }} className={styles.clearBtn}>✕</button>}
                </div>
                <button className={styles.filterBtn} onClick={() => setShowUserFilter(v => !v)}>⚙</button>
              </div>

              {showUserFilter && (
                <div className={styles.filterPanel}>
                  <div className={styles.filterGroup}>
                    <span className={styles.filterGroupLabel}>Role</span>
                    <div className={styles.filterChips}>
                      {[["all","All"],["parent","Parent"],["child","Child"]].map(([v,l]) => (
                        <button key={v} className={`${styles.filterChip} ${userRoleFilter===v ? styles.filterChipActive : ""}`} onClick={() => { setUserRoleFilter(v); loadUsers(1, usersSearch) }}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.filterGroup}>
                    <span className={styles.filterGroupLabel}>Status</span>
                    <div className={styles.filterChips}>
                      {[["all","All"],["active","Active"],["banned","Banned"]].map(([v,l]) => (
                        <button key={v} className={`${styles.filterChip} ${userStatusFilter===v ? styles.filterChipActive : ""}`} onClick={() => { setUserStatusFilter(v); loadUsers(1, usersSearch) }}>{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {usersLoading && users.length === 0 ? (
                  [1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={styles.userSkeleton}>
                      <div className={styles.skelAvatar} />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className={styles.skelLine} style={{ width: '60%' }} />
                        <div className={styles.skelLine} style={{ width: '40%' }} />
                      </div>
                    </div>
                  ))
                ) : users.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div style={{ fontSize: 40 }}>👥</div>
                    <div style={{ color: '#5E8B6E', fontSize: 14 }}>{usersSearch ? 'No users match your search' : 'No users found'}</div>
                    {usersSearch && <button className={styles.clearSearchBtn} onClick={() => { setUsersSearch(''); loadUsers(1, '') }}>Clear search</button>}
                  </div>
                ) : (
                  <>
                    {users.map((user, idx) => {
                      const isSelected = selectedUser?.id === user.id
                      const avatarColor = getAvatarColor(user.name)
                      return (
                        <div key={user.id} onClick={() => setSelectedUser(isSelected ? null : user)} className={`${styles.userCard} ${isSelected ? styles.userCardActive : ''}`} style={{ animationDelay: `${idx * 0.04}s` }}>
                          <div style={{ position: 'relative', flexShrink: 0 }}>
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt={user.name} className={styles.userAvatarImg} style={{ borderColor: isSelected ? '#00E676' : 'transparent' }} />
                            ) : (
                              <div className={styles.userAvatar} style={{ background: avatarColor, borderColor: isSelected ? '#00E676' : 'transparent' }}>{getInitials(user.name)}</div>
                            )}
                            <div className={styles.statusDot} style={{ background: user.is_banned ? '#FF5252' : '#00E676' }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <div className={styles.userName}>{user.name}</div>
                              <div className={styles.roleBadge} style={{
                                background: user.account_type === 'parent' ? 'rgba(0,230,118,0.15)' : 'rgba(41,182,246,0.15)',
                                color: user.account_type === 'parent' ? '#00E676' : '#29B6F6',
                                border: `1px solid ${user.account_type === 'parent' ? 'rgba(0,230,118,0.3)' : 'rgba(41,182,246,0.3)'}`,
                              }}>
                                {user.account_type === 'parent' ? '👨 Parent' : '🧒 Child'}
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: '#5E8B6E', marginBottom: 4 }}>{user.phone}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div className={styles.statusBadge} style={{
                                background: user.is_banned ? 'rgba(255,82,82,0.15)' : 'rgba(0,230,118,0.12)',
                                color: user.is_banned ? '#FF5252' : '#00E676',
                                border: `1px solid ${user.is_banned ? 'rgba(255,82,82,0.3)' : 'rgba(0,230,118,0.25)'}`,
                              }}>
                                {user.is_banned ? '🚫 Banned' : '● Active'}
                              </div>
                              <div style={{ fontSize: 10, color: '#5E8B6E', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ color: '#AB47BC' }}>🔗</span>{user.circle_count} circle{user.circle_count !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {isSelected ? <div className={styles.checkCircle}>✓</div> : <span style={{ color: '#5E8B6E', fontSize: 18, lineHeight: 1 }}>⋮</span>}
                            <div style={{ fontSize: 10, color: '#3A5A45' }}>{new Date(user.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>
                          </div>
                        </div>
                      )
                    })}
                    {users.length < usersTotal && (
                      <button className={styles.loadMoreBtn} onClick={() => loadUsers(usersPage + 1, usersSearch)} disabled={usersLoading}>
                        {usersLoading ? '⟳ Loading...' : `Load more (${usersTotal - users.length} remaining)`}
                      </button>
                    )}
                  </>
                )}
              </div>

              {selectedUser && (
                <div className={styles.actionBar}>
                  <div className={styles.selectedSummary}>
                    <div className={styles.userAvatar} style={{ width: 30, height: 30, fontSize: 11, background: getAvatarColor(selectedUser.name) }}>{getInitials(selectedUser.name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.userName}>{selectedUser.name}</div>
                      <div style={{ fontSize: 11, color: '#5E8B6E' }}>{selectedUser.phone}</div>
                    </div>
                    <button onClick={() => { setSelectedUser(null); setConfirmDelete(null) }} className={styles.clearBtn}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={styles.actionBtnOrange} onClick={() => !actionLoading && handleBan(selectedUser.id, true)} disabled={actionLoading || selectedUser.is_banned} style={{ opacity: selectedUser.is_banned ? 0.5 : 1 }}>
                      <span style={{ fontSize: 16 }}>🚫</span>Ban User
                    </button>
                    <button className={styles.actionBtnBlue} onClick={() => !actionLoading && handleBan(selectedUser.id, false)} disabled={actionLoading || !selectedUser.is_banned} style={{ opacity: !selectedUser.is_banned ? 0.5 : 1 }}>
                      <span style={{ fontSize: 16 }}>✅</span>Unban
                    </button>
                    {confirmDelete === selectedUser.id ? (
                      <button className={styles.actionBtnConfirm} onClick={() => handleDelete(selectedUser.id)} disabled={actionLoading}>
                        <span style={{ fontSize: 16 }}>⚠️</span>Confirm!
                      </button>
                    ) : (
                      <button className={styles.actionBtnRed} onClick={() => !actionLoading && setConfirmDelete(selectedUser.id)} disabled={actionLoading}>
                        <span style={{ fontSize: 16 }}>🗑️</span>Delete
                      </button>
                    )}
                  </div>
                  {confirmDelete === selectedUser.id && <button onClick={() => setConfirmDelete(null)} className={styles.cancelHint}>Cancel deletion</button>}
                </div>
              )}
            </div>
          </div>

          {/* ════════ CIRCLES ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'circles' ? styles.active : ''}`}>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className={styles.searchBar}>
                  <span style={{ fontSize: 14, color: '#5E8B6E' }}>🔍</span>
                  <input type="text" placeholder="Search circles..." value={circlesSearch} onChange={e => setCirclesSearch(e.target.value)} className={styles.searchInput} />
                  {circlesSearch && <button onClick={() => setCirclesSearch('')} className={styles.clearBtn}>✕</button>}
                </div>
                <button className={styles.filterBtn} onClick={loadCircles}>⟳</button>
              </div>

              <div style={{ fontSize: 12, color: '#5E8B6E' }}>
                {circlesLoading ? 'Loading...' : `${filteredCircles.length} circle${filteredCircles.length !== 1 ? 's' : ''}`}
              </div>

              {circlesLoading && (
                <div className={styles.loadingRow}><div className={styles.spinner} /><span style={{ fontSize: 13, color: '#5E8B6E' }}>Loading circles...</span></div>
              )}

              {!circlesLoading && filteredCircles.length === 0 && (
                <div className={styles.emptyCard}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
                  <div style={{ color: '#E8F5E9', fontWeight: 600, marginBottom: 6 }}>{circlesSearch ? 'No circles found' : 'No circles yet'}</div>
                  <div style={{ color: '#5E8B6E', fontSize: 13 }}>{circlesSearch ? 'Try a different search term' : 'Circles created by parents appear here'}</div>
                </div>
              )}

              {!circlesLoading && filteredCircles.map((circle, index) => {
                const iconStyle = getCircleIconStyle(index)
                const isMenuOpen = circleMenuOpen === circle.id
                const isCopied = copiedCode === circle.invite_code
                const isSelected = selectedCircle?.id === circle.id
                return (
                  <div key={circle.id} className={styles.circleCard} style={{ borderColor: isSelected ? 'rgba(0,230,118,0.5)' : 'rgba(0,230,118,0.12)', animationDelay: `${index * 0.04}s` }} onClick={() => setSelectedCircle(prev => prev?.id === circle.id ? null : circle)}>
                    <div className={styles.circleIcon} style={{ background: iconStyle.bg }}>{iconStyle.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.circleName}>{circle.name}</div>
                      <div className={styles.circleOwner}>{circle.owner_name}{circle.owner_phone ? ` · ${circle.owner_phone}` : ''}</div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span className={styles.pillGreen}>👥 {circle.member_count} Member{circle.member_count !== 1 ? 's' : ''}</span>
                        <span className={styles.pillPurple}>📍 {circle.zone_count} Zone{circle.zone_count !== 1 ? 's' : ''}</span>
                      </div>
                      <div className={styles.inviteRow} onClick={e => e.stopPropagation()}>
                        <span className={styles.inviteCode}>{circle.invite_code}</span>
                        <button onClick={e => { e.stopPropagation(); copyInviteCode(circle.invite_code) }} className={styles.copyBtn} style={{ color: isCopied ? '#00E676' : '#5E8B6E', background: isCopied ? 'rgba(0,230,118,0.15)' : 'transparent' }} title="Copy invite code">
                          {isCopied ? '✓' : '⧉'}
                        </button>
                      </div>
                    </div>
                    <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button className={styles.dotMenuBtn} onClick={e => { e.stopPropagation(); setCircleMenuOpen(prev => prev === circle.id ? null : circle.id) }}>⋮</button>
                      {isMenuOpen && (
                        <div className={styles.dropdownMenu}>
                          <button className={styles.dropdownItem} onClick={e => { e.stopPropagation(); handleRegenInvite(circle.id) }}>⟳ Regen Code</button>
                          <button className={styles.dropdownItemRed} onClick={e => { e.stopPropagation(); handleDeleteCircle(circle.id) }}>🗑️ Delete Circle</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {circleMenuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setCircleMenuOpen(null)} />}

              <button className={styles.fabBtn} onClick={() => setShowCreateCircle(true)}>+</button>

              {showCreateCircle && (
                <div className={styles.modalOverlay} onClick={() => setShowCreateCircle(false)}>
                  <div className={styles.bottomSheet} onClick={e => e.stopPropagation()}>
                    <div className={styles.sheetHandle} />
                    <div className={styles.sheetTitle}>Create New Circle</div>
                    <div className={styles.sheetSubtitle}>Set up a new family group</div>
                    <div className={styles.sheetField}>
                      <label className={styles.sheetLabel}>Circle Name</label>
                      <input className={styles.sheetInput} placeholder="e.g. My Family" value={newCircleName} onChange={e => setNewCircleName(e.target.value)} />
                    </div>
                    <div className={styles.sheetField}>
                      <label className={styles.sheetLabel}>Owner Phone Number</label>
                      <input className={styles.sheetInput} placeholder="+91XXXXXXXXXX" value={newCirclePhone} onChange={e => setNewCirclePhone(e.target.value)} />
                    </div>
                    <button className={styles.sheetSubmitBtn} onClick={handleCreateCircle} disabled={creating || !newCircleName.trim() || !newCirclePhone.trim()}>
                      {creating ? "Creating..." : "Create Circle"}
                    </button>
                    <button className={styles.sheetCancelBtn} onClick={() => setShowCreateCircle(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ════════ SOS ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'sos' ? styles.active : ''}`}>
            <div style={{ minHeight: '100%', position: 'relative' }}>
              <div style={{ padding: '14px 16px 0 16px' }}>
                <div className={styles.searchBar}>
                  <span style={{ fontSize: 14, color: '#5E8B6E' }}>🔍</span>
                  <input type="text" placeholder="Search SOS alerts..." value={sosSearch} onChange={e => setSosSearch(e.target.value)} className={styles.searchInput} />
                  {sosSearch && <button onClick={() => setSosSearch('')} className={styles.clearBtn}>✕</button>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, padding: '12px 16px 4px 16px' }}>
                {(['all', 'new', 'resolved'] as const).map(f => {
                  const isActive = sosFilter === f
                  const label = f === 'all' ? `All (${sosEvents.length})` : f === 'new' ? `New (${sosEvents.filter(e => !e.resolved).length})` : `Resolved (${sosEvents.filter(e => e.resolved).length})`
                  const activeColor = f === 'new' ? '#FF5252' : '#00E676'
                  return (
                    <button key={f} onClick={() => setSosFilter(f)} className={styles.filterChip} style={{
                      border: `1px solid ${isActive ? activeColor : 'rgba(0,230,118,0.15)'}`,
                      background: isActive ? (f === 'new' ? 'rgba(255,82,82,0.15)' : 'rgba(0,230,118,0.12)') : 'transparent',
                      color: isActive ? activeColor : '#5E8B6E',
                      fontWeight: isActive ? 700 : 400,
                    }}>
                      {label}
                    </button>
                  )
                })}
              </div>

              {sosLoading && (
                <div className={styles.loadingRow}><div className={styles.spinner} /><span style={{ color: '#5E8B6E', fontSize: 13 }}>Loading SOS alerts...</span></div>
              )}

              {!sosLoading && filteredSos.length === 0 && (
                <div className={styles.emptyState} style={{ padding: '60px 20px' }}>
                  <div style={{ fontSize: 48, lineHeight: 1 }}>🆘</div>
                  <div style={{ color: '#5E8B6E', fontSize: 15, fontWeight: 600 }}>{sosSearch || sosFilter !== 'all' ? 'No matching SOS alerts' : 'No SOS alerts'}</div>
                  <div style={{ color: '#3A5A46', fontSize: 13, textAlign: 'center' }}>{sosSearch || sosFilter !== 'all' ? 'Try a different search or filter' : 'All clear — no active SOS events right now'}</div>
                </div>
              )}

              {!sosLoading && filteredSos.length > 0 && (
                <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredSos.map((sos, idx) => {
                    const isSelected = selectedSos.includes(sos.id)
                    return (
                      <div key={sos.id} onClick={() => toggleSelectSos(sos.id)} className={styles.sosCard} style={{
                        background: isSelected ? 'rgba(255,82,82,0.08)' : '#0D1F13',
                        borderColor: isSelected ? 'rgba(255,82,82,0.5)' : sos.resolved ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.25)',
                        animationDelay: `${idx * 0.05}s`,
                      }}>
                        {isSelected && <div className={styles.selStrip} />}
                        <div className={`${styles.sosCardBadge} ${!sos.resolved ? styles.sosBadgePulse : ''}`} style={{ background: sos.resolved ? 'rgba(0,230,118,0.15)' : '#FF5252' }}>
                          {sos.resolved ? <span style={{ color: '#00E676', fontSize: 18 }}>✓</span> : <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>SOS</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span className={styles.sosName}>{sos.user_name}</span>
                            <span style={{ color: '#5E8B6E', fontSize: 11 }}>{fmtRelTime(sos.created_at)}</span>
                          </div>
                          <div className={styles.sosCoords}>📍 {formatCoords(sos.latitude, sos.longitude)}</div>
                          {sos.message && <div className={styles.sosMessage}>"{sos.message}"</div>}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ color: '#3A5A46', fontSize: 11 }}>{sos.user_phone}</span>
                            <span style={{
                              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                              background: sos.resolved ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.18)',
                              color: sos.resolved ? '#00E676' : '#FF5252',
                              border: `1px solid ${sos.resolved ? 'rgba(0,230,118,0.3)' : 'rgba(255,82,82,0.35)'}`,
                            }}>
                              {sos.resolved ? 'Resolved' : 'New'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {selectedSos.length > 0 && (
                <div className={styles.actionBar} style={{ flexDirection: 'row', gap: 10 }}>
                  <button className={styles.sosResolveBtn} onClick={handleResolveSelected}>✓ Mark Resolved ({selectedSos.length})</button>
                  <button className={styles.sosDismissBtn} onClick={handleDismissSelected}>✗ Dismiss</button>
                </div>
              )}
            </div>
          </div>

          {/* ════════ LOGS ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'logs' ? styles.active : ''}`}>
            <div style={{ padding: 16 }}>
              <div className={styles.subTabBar}>
                <button className={`${styles.subTab} ${logsSubTab === 'geofence' ? styles.subTabActiveGreen : ''}`} onClick={() => setLogsSubTab('geofence')}>📍 Geofence</button>
                <button className={`${styles.subTab} ${logsSubTab === 'otp' ? styles.subTabActiveBlue : ''}`} onClick={() => setLogsSubTab('otp')}>🔑 OTP Logs</button>
              </div>

              {logsSubTab === 'geofence' && (
                <div className={styles.subPaneFadeIn}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    {([
                      { key: 'all', label: 'All', color: '#00E676', count: geoEvents.length },
                      { key: 'entry', label: 'Entry', color: '#00E676', count: geoEvents.filter(e => e.event_type === 'entry').length },
                      { key: 'exit', label: 'Exit', color: '#FF7043', count: geoEvents.filter(e => e.event_type === 'exit').length },
                    ] as const).map(({ key, label, color, count }) => {
                      const isActive = geoFilter === key
                      return (
                        <button key={key} onClick={() => { setGeoFilter(key); setGeoPage(12) }} className={styles.filterChip} style={{
                          border: `1px solid ${isActive ? color : 'rgba(0,230,118,0.12)'}`,
                          background: isActive ? `${color}1A` : 'rgba(8,20,10,0.5)',
                          color: isActive ? color : '#5E8B6E',
                          fontWeight: 700,
                        }}>
                          {label} <span style={{ opacity: 0.8, marginLeft: 4 }}>{count}</span>
                        </button>
                      )
                    })}
                  </div>

                  {geoLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[0, 1, 2, 3, 4].map(i => <div key={i} className={styles.skeleton} style={{ height: 64, borderRadius: 12, animationDelay: `${i * 0.06}s` }} />)}
                    </div>
                  ) : filteredGeo.length === 0 ? (
                    <div className={styles.emptyCard}><div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>{geoFilter === 'all' ? 'No geofence events yet' : `No ${geoFilter} events found`}</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {visibleGeo.map((ev, idx) => {
                          const isEntry = ev.event_type === 'entry'
                          const zoneInfo = getZoneIcon(ev.zone_name)
                          const eventColor = isEntry ? '#00E676' : '#FF5252'
                          return (
                            <div key={ev.id} className={styles.geoRow} style={{ borderLeft: `3px solid ${eventColor}`, animationDelay: `${Math.min(idx * 0.04, 0.28)}s` }}>
                              <div className={styles.geoIcon} style={{ background: zoneInfo.bg, border: `1px solid ${eventColor}33` }}>{zoneInfo.emoji}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className={styles.geoUser}>{ev.user_name || 'Unknown User'}</div>
                                <div style={{ fontSize: 12.5, color: eventColor, fontWeight: 600, marginBottom: 2 }}>
                                  {isEntry ? 'Entered' : 'Exited'} <span style={{ color: '#C8E6D0' }}>{ev.zone_name || 'Unknown Zone'}</span>
                                </div>
                                <div className={styles.geoSub}>{ev.circle_name ? `Circle: ${ev.circle_name}` : ''}{ev.circle_name && ev.phone ? ' · ' : ''}{ev.phone || ''}</div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                                <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', background: isEntry ? 'rgba(0,230,118,0.12)' : 'rgba(255,82,82,0.12)', color: eventColor, border: `1px solid ${eventColor}40` }}>
                                  {isEntry ? 'Entry' : 'Exit'}
                                </span>
                                <span style={{ fontSize: 11, color: '#5E8B6E', fontFamily: 'monospace' }}>{formatGeofenceTime(ev.created_at)}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {hasMoreGeo && <button className={styles.loadMoreBtn} onClick={() => setGeoPage(p => p + 12)}>Load More ({filteredGeo.length - geoPage} remaining)</button>}
                    </>
                  )}
                </div>
              )}

              {logsSubTab === 'otp' && (
                <div className={styles.subPaneFadeIn}>
                  <div className={styles.searchBar} style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 14, color: '#5E8B6E' }}>🔍</span>
                    <input type="text" placeholder="Search by phone number..." value={otpSearch} onChange={e => setOtpSearch(e.target.value)} className={styles.searchInput} />
                    {otpSearch && <button onClick={() => setOtpSearch('')} className={styles.clearBtn}>✕</button>}
                  </div>

                  {otpsLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[0, 1, 2, 3, 4].map(i => <div key={i} className={styles.skeleton} style={{ height: 48, borderRadius: 10, animationDelay: `${i * 0.06}s` }} />)}
                    </div>
                  ) : filteredOtps.length === 0 ? (
                    <div className={styles.emptyCard}><div style={{ fontSize: 32, marginBottom: 8 }}>🔑</div>{otpSearch ? `No OTPs found for "${otpSearch}"` : 'No OTP records found'}</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                      {filteredOtps.map((otp, i) => {
                        const status = getOtpStatus(otp)
                        const expired = isExpired(otp.expires_at)
                        return (
                          <div key={i} className={styles.otpRow}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'monospace', color: '#29B6F6', fontSize: 13, fontWeight: 600 }}>{otp.phone}</div>
                              <div style={{ fontSize: 10, color: '#5E8B6E', marginTop: 2 }}>{formatDate(otp.created_at)}</div>
                            </div>
                            <div style={{ textAlign: 'center', minWidth: 70 }}>
                              <span style={{
                                fontFamily: 'monospace', fontSize: 15, letterSpacing: '3px', fontWeight: 700,
                                color: status === 'active' ? '#00E676' : '#5E8B6E',
                                textDecoration: status === 'active' ? 'none' : 'line-through',
                              }}>{otp.code}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                              {status === 'used' && <span className={styles.badgeGreen}>Used</span>}
                              {status === 'active' && <span className={`${styles.badgeYellow} ${styles.sosBadgePulse}`}>Unused</span>}
                              {status === 'expired' && <span className={styles.badgeRed}>Expired</span>}
                              <span style={{ fontSize: 10, fontFamily: 'monospace', color: expired ? '#5E8B6E' : '#FFB300' }}>{formatRelativeOtp(otp.expires_at)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className={styles.debugCard}>
                    <div className={styles.debugTitle}>SMS Debug Info<span className={styles.divider} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                      {[
                        { label: 'Today Sent', value: String(smsStats.todaySent), color: '#29B6F6', icon: '📤' },
                        { label: 'Today Delivered', value: String(smsStats.todayDelivered), color: '#00E676', icon: '✅' },
                        { label: 'Failed', value: String(smsStats.failed), color: '#FF5252', icon: '❌' },
                        { label: 'Delivery Rate', value: `${smsStats.deliveryRate}%`, color: smsStats.deliveryRate >= 80 ? '#00E676' : smsStats.deliveryRate >= 50 ? '#FFB300' : '#FF5252', icon: '📊' },
                      ].map(({ label, value, color, icon }) => (
                        <div key={label} className={styles.miniStat}>
                          <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
                          <div className={styles.miniStatLabel}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ════════ SYSTEM ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'system' ? styles.active : ''}`}>
            <div style={{ padding: 16 }}>
              {sysLoading && !sysData ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className={styles.skeleton} style={{ height: 70, borderRadius: 12, animationDelay: `${i * 0.06}s` }} />)}
                </div>
              ) : (
                <>
                  <div className={styles.sysLabel}>Database<span className={styles.divider} /></div>
                  <div className={styles.miniGrid}>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>🗄️</span><span className={styles.miniCardLabel}>DB Size</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#00E676' }}>{sysData?.dbSize ?? '—'}</div>
                      <div className={styles.miniCardSub}>PostgreSQL storage</div>
                    </div>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>📋</span><span className={styles.miniCardLabel}>Tables</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#29B6F6' }}>{sysData?.tables?.length != null ? String(sysData.tables.length) : '—'}</div>
                      <div className={styles.miniCardSub}>Tables tracked</div>
                    </div>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>📊</span><span className={styles.miniCardLabel}>Total Rows</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#AB47BC' }}>{totalRows > 0 ? (totalRows >= 1_000_000 ? `${(totalRows / 1_000_000).toFixed(2)}M` : totalRows.toLocaleString()) : '—'}</div>
                      <div className={styles.miniCardSub}>Across all tables</div>
                    </div>
                  </div>

                  <div className={styles.sysLabel}>Server<span className={styles.divider} /></div>
                  <div className={styles.miniGrid}>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>⏱️</span><span className={styles.miniCardLabel}>Uptime</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#00E676' }}>{sysData?.uptime != null ? formatUptime(sysData.uptime) : '—'}</div>
                      <div className={styles.miniCardSub}>Since restart</div>
                    </div>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>⬢</span><span className={styles.miniCardLabel}>Node</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#68D391', fontSize: 16 }}>{sysData?.nodeVersion ?? '—'}</div>
                      <div className={styles.miniCardSub}>Runtime</div>
                    </div>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>🌐</span><span className={styles.miniCardLabel}>Env</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#FFB300', fontSize: 14 }}>Production</div>
                      <div className={styles.miniCardSub}>NODE_ENV</div>
                    </div>
                  </div>

                  <div className={styles.sysLabel}>Realtime<span className={styles.divider} /></div>
                  <div className={styles.miniGrid}>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>📡</span><span className={styles.miniCardLabel}>SSE</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#00E676' }}>{sysData?.connectedClients != null ? String(sysData.connectedClients) : '—'}</div>
                      <div className={styles.miniCardSub}>Live clients</div>
                    </div>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>🔀</span><span className={styles.miniCardLabel}>Streams</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#29B6F6' }}>{sysData?.connectedClients != null ? String(sysData.connectedClients) : '—'}</div>
                      <div className={styles.miniCardSub}>Open streams</div>
                    </div>
                    <div className={styles.miniCard}>
                      <div className={styles.miniCardHead}><span>🚦</span><span className={styles.miniCardLabel}>Rate</span></div>
                      <div className={styles.miniCardValue} style={{ color: '#AB47BC', fontSize: 14 }}>{sysData?.rateLimit?.max != null ? `${sysData.rateLimit.max}/min` : '—'}</div>
                      <div className={styles.miniCardSub}>Req per window</div>
                    </div>
                  </div>

                  <div className={styles.dangerZone}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div className={styles.dangerIcon}>⚠️</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#FF5252' }}>Danger Zone</div>
                        <div style={{ fontSize: 11, color: '#6B3A3A', marginTop: 1 }}>Irreversible operations</div>
                      </div>
                    </div>
                    <div style={{ height: 1, background: 'rgba(255,82,82,0.1)', margin: '14px 0' }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#CC4444', marginBottom: 6 }}>Purge Old Location History</div>
                    <div style={{ fontSize: 12, color: '#6B3A3A', marginBottom: 14, lineHeight: 1.6 }}>
                      Permanently deletes GPS records older than the selected threshold. This <strong style={{ color: '#CC4444' }}>cannot be reversed</strong>.
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                      <select value={purgeDays} onChange={e => { setPurgeDays(Number(e.target.value)); setPurgeConfirm(false) }} className={styles.purgeSelect}>
                        <option value={7}>7 days</option>
                        <option value={14}>14 days</option>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                      </select>
                      {!purgeConfirm ? (
                        <button className={styles.purgeBtn} onClick={() => setPurgeConfirm(true)} disabled={purgeLoading}>🗑️ Purge Now</button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <button className={styles.purgeConfirmBtn} onClick={handlePurge} disabled={purgeLoading}>{purgeLoading ? 'Purging...' : '✓ Yes, Purge'}</button>
                          <button className={styles.purgeCancelBtn} onClick={() => setPurgeConfirm(false)}>Cancel</button>
                        </div>
                      )}
                    </div>
                    {purgeResult && (
                      <div style={{
                        padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                        background: purgeResult.ok ? 'rgba(0,200,83,0.08)' : 'rgba(204,68,68,0.08)',
                        border: `1px solid ${purgeResult.ok ? 'rgba(0,200,83,0.22)' : 'rgba(204,68,68,0.22)'}`,
                        color: purgeResult.ok ? '#00C853' : '#CC4444',
                      }}>
                        {purgeResult.text}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ════════ BROADCAST ════════ */}
          <div className={`${styles.tabPane} ${activeTab === 'broadcast' ? styles.active : ''}`}>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div className={styles.composeCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📡</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#C8E6D0' }}>Broadcast Center</div>
                    <div style={{ fontSize: 11, color: '#5E8B6E', marginTop: 2 }}>Send real-time messages to all connected users</div>
                  </div>
                </div>

                <div>
                  <div className={styles.fieldLabel}>Message Type</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                    {(['info', 'warning', 'alert'] as const).map(t => {
                      const cfg = typeConfig[t]
                      const active = bType === t
                      return (
                        <button key={t} onClick={() => setBType(t)} className={styles.typeCard} style={{
                          background: active ? cfg.bg : 'rgba(5,12,7,0.8)',
                          border: `1px solid ${active ? cfg.border : 'rgba(0,230,118,0.08)'}`,
                          transform: active ? 'translateY(-2px)' : 'none',
                        }}>
                          <span style={{ fontSize: 22 }}>{cfg.icon}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.3, textAlign: 'center', color: active ? cfg.color : '#5E8B6E' }}>{cfg.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className={styles.fieldLabel} style={{ marginBottom: 0 }}>Message</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: charCount > MAX_CHARS * 0.9 ? (charCount >= MAX_CHARS ? '#FF5252' : '#FFB300') : '#5E8B6E' }}>{charCount} / {MAX_CHARS}</span>
                  </div>
                  <textarea value={bMessage} onChange={e => setBMessage(e.target.value.slice(0, MAX_CHARS))} placeholder="Enter your message here..." rows={5} className={styles.broadcastTextarea} style={{ borderColor: charCount >= MAX_CHARS ? 'rgba(255,82,82,0.35)' : 'rgba(0,230,118,0.15)' }} />
                </div>

                <div>
                  <div className={styles.fieldLabel}>Target Audience</div>
                  <div className={styles.audienceCard}>
                    <div className={styles.audienceIcon}>👥</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#C8E6D0', marginBottom: 2 }}>All Connected Users</div>
                      <div style={{ fontSize: 11, color: '#5E8B6E' }}>
                        Broadcast to all online users
                        {sysData?.connectedClients != null && <span style={{ color: '#00E676', fontWeight: 700, marginLeft: 4 }}>({sysData.connectedClients} connected)</span>}
                      </div>
                    </div>
                    <div className={styles.liveBadge}>LIVE</div>
                  </div>
                </div>

                <button className={styles.sendBtn} onClick={handleBroadcast} disabled={bLoading || charCount === 0 || charCount > MAX_CHARS} style={{ opacity: charCount === 0 || charCount > MAX_CHARS ? 0.5 : 1 }}>
                  <span style={{ fontSize: 18 }}>{bLoading ? '⏳' : '📡'}</span>
                  {bLoading ? 'Sending Broadcast...' : 'Send Broadcast'}
                </button>

                {bResult && (
                  <div style={{
                    padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                    background: bResult.ok ? 'rgba(0,230,118,0.08)' : 'rgba(255,82,82,0.08)',
                    border: `1px solid ${bResult.ok ? 'rgba(0,230,118,0.25)' : 'rgba(255,82,82,0.25)'}`,
                    color: bResult.ok ? '#00C853' : '#CC4444',
                  }}>
                    {bResult.ok ? '✓ ' : '✗ '}{bResult.text}
                  </div>
                )}
              </div>

              <div>
                <div className={styles.sysLabel}>Recent Broadcasts<span className={styles.divider} /></div>
                {recentBroadcasts.length === 0 ? (
                  <div className={styles.emptyCard}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                    <div style={{ fontSize: 13, color: '#5E8B6E', fontWeight: 500 }}>No broadcasts sent yet</div>
                    <div style={{ fontSize: 11, color: '#3A5A45', marginTop: 4 }}>Messages appear here after sending</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {recentBroadcasts.map(b => {
                      const cfg = typeConfig[b.type]
                      return (
                        <div key={b.id} className={styles.broadcastRecord} style={{ borderLeft: `3px solid ${cfg.color}` }}>
                          <div className={styles.broadcastIcon} style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>{cfg.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className={styles.broadcastMsg}>{b.message}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>{cfg.label}</span>
                              <span style={{ fontSize: 10, color: '#5E8B6E' }}>Sent to {b.recipients} user{b.recipients !== 1 ? 's' : ''}</span>
                              <span style={{ fontSize: 10, color: '#3A5A45', marginLeft: 'auto' }}>{timeAgo(b.sentAt)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
