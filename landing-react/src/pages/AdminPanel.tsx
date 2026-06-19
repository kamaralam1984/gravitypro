import styles from './AdminPanel.module.css'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'

const API = window.location.origin + '/api/v1/admin'

// ── Interfaces ──────────────────────────────────────────────────────────────

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

interface DashboardResponse {
  stats: DashboardStats
}

interface OtpRecord {
  phone: string
  code: string
  expires_at: string
  used: boolean
  created_at: string
}

interface OtpsResponse {
  otps: OtpRecord[]
}

interface User {
  id: string
  name: string
  phone: string
  email: string
  user_type: 'parent' | 'child'
  country: string
  circle_count: number
  created_at: string
  is_banned: boolean
  avatar_url?: string
}

interface UsersResponse {
  users: User[]
  total: number
  page: number
  limit: number
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

interface CirclesResponse {
  circles: Circle[]
}

interface SosEvent {
  id: string
  user_name: string
  user_phone: string
  message: string
  latitude: number
  longitude: number
  resolved: boolean
  created_at: string
}

interface SosResponse {
  sos_events: SosEvent[]
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

interface GeofencesResponse {
  events: GeofenceEvent[]
}

interface TableStat {
  name: string
  rows: number
}

interface RateLimit {
  max: number
  windowMs: number
}

interface SystemData {
  dbSize: string
  tables: TableStat[]
  nodeVersion: string
  uptime: number
  rateLimit: RateLimit
}

interface SystemResponse extends SystemData {}

interface Toast {
  message: string
  type: 'ok' | 'err'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(str: string): string {
  return new Date(str).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatRelativeOtp(expiresAt: string): string {
  const now = Date.now()
  const exp = new Date(expiresAt).getTime()
  const diffMs = exp - now
  if (diffMs > 0) {
    const totalSec = Math.floor(diffMs / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `in ${mins}m ${secs}s`
  } else {
    const totalSec = Math.floor(-diffMs / 1000)
    const mins = Math.floor(totalSec / 60)
    return `${mins}m ago`
  }
}

function formatGeofenceTime(str: string): string {
  const d = new Date(str)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', ' ·')
}

function getOtpStatus(otp: OtpRecord): 'used' | 'active' | 'expired' {
  if (otp.used) return 'used'
  if (new Date(otp.expires_at).getTime() > Date.now()) return 'active'
  return 'expired'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState('dashboard')
  const adminToken = localStorage.getItem('admin_token') || ''

  // Toast
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(message: string, type: 'ok' | 'err') {
    setToast({ message, type })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // Auth check
  useEffect(() => {
    if (!adminToken) navigate('/admin/login')
  }, [])

  // Last refresh
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // ── Dashboard state ──
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null)
  const [dashLoading, setDashLoading] = useState(false)
  const [recentOtps, setRecentOtps] = useState<OtpRecord[]>([])

  // ── Users state ──
  const [users, setUsers] = useState<User[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [usersSearch, setUsersSearch] = useState('')
  const [usersLoading, setUsersLoading] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Circles state ──
  const [circles, setCircles] = useState<Circle[]>([])
  const [circlesLoading, setCirclesLoading] = useState(false)

  // ── SOS state ──
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([])
  const [sosLoading, setSosLoading] = useState(false)

  // ── Geofences state ──
  const [geoEvents, setGeoEvents] = useState<GeofenceEvent[]>([])
  const [geoLoading, setGeoLoading] = useState(false)

  // ── System state ──
  const [sysData, setSysData] = useState<SystemData | null>(null)
  const [sysLoading, setSysLoading] = useState(false)
  const [purgeDays, setPurgeDays] = useState(30)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)
  const [purgeLoading, setPurgeLoading] = useState(false)

  // ── OTPs state ──
  const [otps, setOtps] = useState<OtpRecord[]>([])
  const [otpsLoading, setOtpsLoading] = useState(false)

  // ── Broadcast state ──
  const [bMessage, setBMessage] = useState('')
  const [bType, setBType] = useState('info')
  const [bLoading, setBLoading] = useState(false)
  const [bResult, setBResult] = useState<{ ok: boolean; text: string } | null>(null)

  // ── API helper ──
  const apiCall = useCallback(
    async (path: string, method = 'GET', body?: object) => {
      try {
        const res = await fetch(API + path, {
          method,
          headers: {
            'x-admin-token': adminToken,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        if (res.status === 401) {
          localStorage.removeItem('admin_token')
          navigate('/admin/login')
          return null
        }
        return await res.json()
      } catch {
        return null
      }
    },
    [adminToken, navigate]
  )

  // ── Fetch functions ──────────────────────────────────────────────────────

  const fetchDashboard = useCallback(async () => {
    setDashLoading(true)
    const data: DashboardResponse | null = await apiCall('/dashboard')
    if (data?.stats) setDashStats(data.stats)
    // Also fetch recent OTPs for dashboard
    const otpData: OtpsResponse | null = await apiCall('/otps')
    if (otpData?.otps) setRecentOtps(otpData.otps.slice(0, 5))
    setDashLoading(false)
  }, [apiCall])

  const fetchUsers = useCallback(
    async (page: number, search: string) => {
      setUsersLoading(true)
      const params = new URLSearchParams({ page: String(page), search, limit: '20' })
      const data: UsersResponse | null = await apiCall(`/users?${params}`)
      if (data) {
        setUsers(data.users || [])
        setUsersTotal(data.total || 0)
      }
      setUsersLoading(false)
    },
    [apiCall]
  )

  const fetchCircles = useCallback(async () => {
    setCirclesLoading(true)
    const data: CirclesResponse | null = await apiCall('/circles')
    if (data?.circles) setCircles(data.circles)
    setCirclesLoading(false)
  }, [apiCall])

  const fetchSos = useCallback(async () => {
    setSosLoading(true)
    const data: SosResponse | null = await apiCall('/sos')
    if (data?.sos_events) setSosEvents(data.sos_events)
    setSosLoading(false)
  }, [apiCall])

  const fetchGeofences = useCallback(async () => {
    setGeoLoading(true)
    const data: GeofencesResponse | null = await apiCall('/geofences')
    if (data?.events) setGeoEvents(data.events)
    setGeoLoading(false)
  }, [apiCall])

  const fetchSystem = useCallback(async () => {
    setSysLoading(true)
    const data: SystemResponse | null = await apiCall('/system')
    if (data) setSysData(data)
    setSysLoading(false)
  }, [apiCall])

  const fetchOtps = useCallback(async () => {
    setOtpsLoading(true)
    const data: OtpsResponse | null = await apiCall('/otps')
    if (data?.otps) setOtps(data.otps)
    setOtpsLoading(false)
  }, [apiCall])

  // ── Section load effect ──────────────────────────────────────────────────

  useEffect(() => {
    if (!adminToken) return
    switch (activeSection) {
      case 'dashboard':
        fetchDashboard()
        break
      case 'users':
        fetchUsers(usersPage, usersSearch)
        break
      case 'circles':
        fetchCircles()
        break
      case 'sos':
        fetchSos()
        break
      case 'geofences':
        fetchGeofences()
        break
      case 'system':
        fetchSystem()
        break
      case 'otps':
        fetchOtps()
        break
    }
  }, [activeSection, lastRefresh])

  // ── Users search debounce ─────────────────────────────────────────────────

  function handleSearchChange(val: string) {
    setUsersSearch(val)
    setUsersPage(1)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => {
      fetchUsers(1, val)
    }, 500)
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  function refresh() {
    setLastRefresh(new Date())
  }

  // ── User actions ──────────────────────────────────────────────────────────

  async function handleBanUser(user: User) {
    const action = user.is_banned ? 'unban' : 'ban'
    const data = await apiCall(`/users/${user.id}/ban`, 'PATCH')
    if (data) {
      showToast(`User ${action}ned successfully`, 'ok')
      fetchUsers(usersPage, usersSearch)
    } else {
      showToast(`Failed to ${action} user`, 'err')
    }
  }

  async function handleDeleteUser(user: User) {
    if (!window.confirm(`Delete user ${user.name || user.phone}? This cannot be undone.`)) return
    const data = await apiCall(`/users/${user.id}`, 'DELETE')
    if (data !== null) {
      showToast('User deleted', 'ok')
      fetchUsers(usersPage, usersSearch)
    } else {
      showToast('Failed to delete user', 'err')
    }
  }

  async function handleUserPageChange(newPage: number) {
    setUsersPage(newPage)
    fetchUsers(newPage, usersSearch)
  }

  // ── Circle actions ────────────────────────────────────────────────────────

  async function handleDeleteCircle(circle: Circle) {
    if (!window.confirm(`Delete circle "${circle.name}"? This cannot be undone.`)) return
    const data = await apiCall(`/circles/${circle.id}`, 'DELETE')
    if (data !== null) {
      showToast('Circle deleted', 'ok')
      fetchCircles()
    } else {
      showToast('Failed to delete circle', 'err')
    }
  }

  async function handleRegenInvite(circle: Circle) {
    const data = await apiCall(`/circles/${circle.id}/invite`, 'PATCH')
    if (data) {
      showToast('Invite code regenerated', 'ok')
      fetchCircles()
    } else {
      showToast('Failed to regenerate invite code', 'err')
    }
  }

  async function handleCopyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      showToast('Invite code copied!', 'ok')
    } catch {
      // Fallback
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      showToast('Invite code copied!', 'ok')
    }
  }

  // ── SOS actions ───────────────────────────────────────────────────────────

  async function handleResolveSos(sos: SosEvent) {
    const data = await apiCall(`/sos/${sos.id}/resolve`, 'PATCH')
    if (data) {
      showToast('SOS alert resolved', 'ok')
      fetchSos()
    } else {
      showToast('Failed to resolve SOS', 'err')
    }
  }

  // ── System actions ────────────────────────────────────────────────────────

  async function handlePurge() {
    if (!window.confirm(`Purge location data older than ${purgeDays} days? This cannot be undone.`)) return
    setPurgeLoading(true)
    setPurgeResult(null)
    const data = await apiCall(`/locations/purge?days=${purgeDays}`, 'DELETE')
    setPurgeLoading(false)
    if (data) {
      const deleted = data.deleted ?? data.rows ?? 0
      setPurgeResult(`Purged ${deleted} location records older than ${purgeDays} days.`)
      showToast('Purge complete', 'ok')
    } else {
      setPurgeResult('Purge failed. Check server logs.')
      showToast('Purge failed', 'err')
    }
  }

  // ── Broadcast action ──────────────────────────────────────────────────────

  async function handleBroadcast() {
    if (!bMessage.trim()) {
      showToast('Please enter a message', 'err')
      return
    }
    setBLoading(true)
    setBResult(null)
    const data = await apiCall('/broadcast', 'POST', { message: bMessage.trim(), type: bType })
    setBLoading(false)
    if (data) {
      setBResult({ ok: true, text: `Broadcast sent to ${data.sent ?? 'all'} connected users.` })
      showToast('Broadcast sent!', 'ok')
      setBMessage('')
    } else {
      setBResult({ ok: false, text: 'Failed to send broadcast. Check server logs.' })
      showToast('Broadcast failed', 'err')
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  function handleLogout() {
    localStorage.removeItem('admin_token')
    navigate('/admin/login')
  }

  // ── Section titles ────────────────────────────────────────────────────────

  const sectionTitles: Record<string, string> = {
    dashboard: 'Dashboard',
    users: 'User Management',
    circles: 'Circle Management',
    sos: 'SOS Alerts',
    geofences: 'Geofence Events',
    system: 'System & Infrastructure',
    otps: 'OTP Logs',
    broadcast: 'Broadcast',
  }

  // ── Section renderers ─────────────────────────────────────────────────────

  function renderDashboard() {
    if (dashLoading) {
      return (
        <div className={styles.loadingWrap}>
          <div className={styles.spinner}></div>
          Loading dashboard...
        </div>
      )
    }
    const s = dashStats
    return (
      <div className={styles.tabContent}>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statValue}>{s?.totalUsers ?? 0}</div>
            <div className={styles.statLabel}>Total Users</div>
            <div className={styles.statSub}>All registered accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>🧑‍👩‍👧</div>
            <div className={styles.statValue}>{s?.parents ?? 0}</div>
            <div className={styles.statLabel}>Parents</div>
            <div className={styles.statSub}>Parent accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>👶</div>
            <div className={styles.statValue}>{s?.children ?? 0}</div>
            <div className={styles.statLabel}>Children</div>
            <div className={styles.statSub}>Child accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>🚫</div>
            <div className={styles.statValue}>{s?.banned ?? 0}</div>
            <div className={styles.statLabel}>Banned</div>
            <div className={styles.statSub}>Suspended accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>⭕</div>
            <div className={styles.statValue}>{s?.totalCircles ?? 0}</div>
            <div className={styles.statLabel}>Circles</div>
            <div className={styles.statSub}>Family circles</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>🟢</div>
            <div className={styles.statValue}>{s?.activeUsers ?? 0}</div>
            <div className={styles.statLabel}>Active Users</div>
            <div className={styles.statSub}>Last 24 hours</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>🆘</div>
            <div className={styles.statValue}>{s?.sosToday ?? 0}</div>
            <div className={styles.statLabel}>SOS Today</div>
            <div className={styles.statSub}>Emergency alerts today</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>🗺️</div>
            <div className={styles.statValue}>{s?.geofenceEvents ?? 0}</div>
            <div className={styles.statLabel}>Geofence Events</div>
            <div className={styles.statSub}>Total zone triggers</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>📍</div>
            <div className={styles.statValue}>{s?.locationPoints ?? 0}</div>
            <div className={styles.statLabel}>Location Points</div>
            <div className={styles.statSub}>Stored GPS records</div>
          </div>
        </div>

        <div className={styles.tableWrap} style={{ marginTop: 0 }}>
          <table className={styles.adminTable}>
            <thead>
              <tr>
                <th colSpan={4} style={{ color: '#00E676', fontSize: '13px', textTransform: 'none', letterSpacing: 0 }}>
                  Recent Activity — Last 5 OTP Requests
                </th>
              </tr>
              <tr>
                <th>Phone</th>
                <th>OTP Code</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentOtps.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: '#3E6B4E', padding: '24px' }}>
                    No recent OTP records
                  </td>
                </tr>
              ) : (
                recentOtps.map((otp, i) => {
                  const status = getOtpStatus(otp)
                  return (
                    <tr key={i}>
                      <td>{otp.phone}</td>
                      <td>
                        {status === 'active' ? (
                          <span className={styles.otpCode}>{otp.code}</span>
                        ) : (
                          <span className={styles.expiredText}>{otp.code}</span>
                        )}
                      </td>
                      <td>
                        {status === 'used' && <span className={`${styles.badge} ${styles.badgeUsed}`}>Used</span>}
                        {status === 'active' && <span className={`${styles.badge} ${styles.badgeUnused}`}>Active</span>}
                        {status === 'expired' && <span className={`${styles.badge} ${styles.badgeWarning}`}>Expired</span>}
                      </td>
                      <td style={{ color: '#5E8B6E', fontSize: '12px' }}>{formatDate(otp.created_at)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderUsers() {
    const totalPages = Math.max(1, Math.ceil(usersTotal / 20))
    return (
      <div className={styles.tabContent}>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            placeholder="Search by name, phone, or email..."
            value={usersSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <span className={styles.sectionCount}>{usersTotal} users</span>
        </div>

        {usersLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner}></div>
            Loading users...
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.adminTable}>
                <thead>
                  <tr>
                    <th>Avatar</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Type</th>
                    <th>Country</th>
                    <th>Circles</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: '#3E6B4E', padding: '32px' }}>
                        No users found
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt={user.name} className={styles.userAvatar} />
                          ) : (
                            <span className={styles.userAvatarFallback}>
                              {(user.name || user.phone || '?')[0].toUpperCase()}
                            </span>
                          )}
                        </td>
                        <td style={{ fontWeight: 500 }}>{user.name || '—'}</td>
                        <td style={{ fontFamily: 'monospace', color: '#00E676' }}>{user.phone}</td>
                        <td style={{ color: '#5E8B6E', fontSize: '12px' }}>{user.email || '—'}</td>
                        <td>
                          {user.user_type === 'parent' ? (
                            <span className={`${styles.badge} ${styles.badgeParent}`}>Parent</span>
                          ) : (
                            <span className={`${styles.badge} ${styles.badgeChild}`}>Child</span>
                          )}
                        </td>
                        <td style={{ color: '#5E8B6E' }}>{user.country || '—'}</td>
                        <td style={{ textAlign: 'center' }}>{user.circle_count ?? 0}</td>
                        <td style={{ color: '#5E8B6E', fontSize: '12px' }}>{formatDate(user.created_at)}</td>
                        <td>
                          {user.is_banned ? (
                            <span className={`${styles.badge} ${styles.badgeBanned}`}>Banned</span>
                          ) : (
                            <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className={`${styles.btnSm} ${styles.btnWarning}`}
                              onClick={() => handleBanUser(user)}
                            >
                              {user.is_banned ? 'Unban' : 'Ban'}
                            </button>
                            <button
                              className={`${styles.btnSm} ${styles.btnDanger}`}
                              onClick={() => handleDeleteUser(user)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                disabled={usersPage <= 1}
                onClick={() => handleUserPageChange(usersPage - 1)}
              >
                ← Prev
              </button>
              <span className={styles.pageCurrent}>
                Page {usersPage} of {totalPages}
              </span>
              <button
                className={styles.pageBtn}
                disabled={usersPage >= totalPages}
                onClick={() => handleUserPageChange(usersPage + 1)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  function renderCircles() {
    return (
      <div className={styles.tabContent}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Family Circles</span>
          <span className={styles.sectionCount}>{circles.length} circles</span>
        </div>

        {circlesLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner}></div>
            Loading circles...
          </div>
        ) : circles.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>⭕</div>
            <div className={styles.emptyText}>No circles found</div>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.adminTable}>
              <thead>
                <tr>
                  <th>Circle Name</th>
                  <th>Owner</th>
                  <th>Members</th>
                  <th>Zones</th>
                  <th>Invite Code</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {circles.map((circle) => (
                  <tr key={circle.id}>
                    <td style={{ fontWeight: 600, color: '#E8F5E9' }}>{circle.name}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{circle.owner_name || '—'}</div>
                      <div style={{ fontSize: '11px', color: '#5E8B6E', fontFamily: 'monospace' }}>
                        {circle.owner_phone}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>{circle.member_count ?? 0}</td>
                    <td style={{ textAlign: 'center' }}>{circle.zone_count ?? 0}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: 'monospace', color: '#00E676', letterSpacing: '2px' }}>
                          {circle.invite_code}
                        </span>
                        <button
                          className={`${styles.btnSm} ${styles.btnInfo}`}
                          onClick={() => handleCopyInvite(circle.invite_code)}
                          title="Copy invite code"
                        >
                          Copy
                        </button>
                      </div>
                    </td>
                    <td style={{ color: '#5E8B6E', fontSize: '12px' }}>{formatDate(circle.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className={`${styles.btnSm} ${styles.btnInfo}`}
                          onClick={() => handleRegenInvite(circle)}
                        >
                          🔄 New Code
                        </button>
                        <button
                          className={`${styles.btnSm} ${styles.btnDanger}`}
                          onClick={() => handleDeleteCircle(circle)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  function renderSos() {
    const unresolvedCount = sosEvents.filter((e) => !e.resolved).length
    return (
      <div className={styles.tabContent}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>SOS Alerts</span>
          <span className={styles.sectionCount}>{unresolvedCount} unresolved</span>
        </div>

        {sosLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner}></div>
            Loading SOS alerts...
          </div>
        ) : sosEvents.length === 0 ? (
          <div className={styles.sosEmpty}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🆘</div>
            <div style={{ fontSize: '14px', color: '#5E8B6E' }}>
              No SOS events recorded yet. SOS alerts appear here when triggered.
            </div>
          </div>
        ) : (
          <div>
            {sosEvents.map((sos) => (
              <div key={sos.id} className={styles.sosAlert}>
                <div className={styles.sosAlertInfo}>
                  <div className={styles.sosAlertName}>{sos.user_name || 'Unknown User'}</div>
                  <div className={styles.sosAlertMsg} style={{ color: '#29B6F6', fontSize: '12px', marginTop: '2px' }}>
                    {sos.user_phone}
                  </div>
                  {sos.message && (
                    <div className={styles.sosAlertMsg} style={{ marginTop: '4px' }}>
                      {sos.message}
                    </div>
                  )}
                  <div className={styles.sosAlertTime}>
                    {formatDate(sos.created_at)}
                    {sos.latitude && sos.longitude && (
                      <span style={{ marginLeft: '8px' }}>
                        📍 {sos.latitude.toFixed(4)}, {sos.longitude.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  {sos.resolved ? (
                    <span className={`${styles.badge} ${styles.badgeResolved}`}>RESOLVED</span>
                  ) : (
                    <>
                      <span className={`${styles.badge} ${styles.badgeSOS}`}>ACTIVE</span>
                      <button
                        className={`${styles.btnSm} ${styles.btnSuccess}`}
                        onClick={() => handleResolveSos(sos)}
                      >
                        Resolve
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderGeofences() {
    return (
      <div className={styles.tabContent}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Geofence Events</span>
          <span className={styles.sectionCount}>{geoEvents.length} events</span>
        </div>

        {geoLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner}></div>
            Loading geofence events...
          </div>
        ) : geoEvents.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🗺️</div>
            <div className={styles.emptyText}>No geofence events yet</div>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.adminTable}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Phone</th>
                  <th>Zone</th>
                  <th>Circle</th>
                  <th>Event</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {geoEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td style={{ fontWeight: 500 }}>{ev.user_name || '—'}</td>
                    <td style={{ fontFamily: 'monospace', color: '#5E8B6E', fontSize: '12px' }}>{ev.phone}</td>
                    <td>{ev.zone_name || '—'}</td>
                    <td style={{ color: '#5E8B6E' }}>{ev.circle_name || '—'}</td>
                    <td>
                      {ev.event_type === 'entry' ? (
                        <span className={`${styles.badge} ${styles.badgeEntry}`}>Entry</span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeExit}`}>Exit</span>
                      )}
                    </td>
                    <td style={{ color: '#5E8B6E', fontSize: '12px' }}>{formatGeofenceTime(ev.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  function renderSystem() {
    const maxRows = sysData?.tables?.length
      ? Math.max(...sysData.tables.map((t) => t.rows), 1)
      : 1

    return (
      <div className={styles.tabContent}>
        {sysLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner}></div>
            Loading system info...
          </div>
        ) : (
          <>
            <div className={styles.sysGrid}>
              <div className={styles.sysCard}>
                <div className={styles.sysCardTitle}>Database Size</div>
                <div className={styles.sysCardValue}>{sysData?.dbSize ?? '—'}</div>
                <div className={styles.sysCardSub}>Total PostgreSQL storage</div>
              </div>
              <div className={styles.sysCard}>
                <div className={styles.sysCardTitle}>Node Version</div>
                <div className={styles.sysCardValue}>{sysData?.nodeVersion ?? '—'}</div>
                <div className={styles.sysCardSub}>Runtime version</div>
              </div>
              <div className={styles.sysCard}>
                <div className={styles.sysCardTitle}>Server Uptime</div>
                <div className={styles.sysCardValue}>
                  {sysData?.uptime != null ? formatUptime(sysData.uptime) : '—'}
                </div>
                <div className={styles.sysCardSub}>Since last restart</div>
              </div>
              <div className={styles.sysCard}>
                <div className={styles.sysCardTitle}>Rate Limit</div>
                <div className={styles.sysCardValue}>
                  {sysData?.rateLimit?.max != null ? `${sysData.rateLimit.max} / 15 min` : '—'}
                </div>
                <div className={styles.sysCardSub}>Max requests per window</div>
              </div>
            </div>

            {sysData?.tables && sysData.tables.length > 0 && (
              <div className={styles.tableStatsWrap}>
                <table className={styles.adminTable}>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Row Count</th>
                      <th style={{ width: '40%' }}>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sysData.tables.map((tbl) => (
                      <tr key={tbl.name}>
                        <td style={{ fontFamily: 'monospace', color: '#00E676' }}>{tbl.name}</td>
                        <td style={{ color: '#E8F5E9', fontWeight: 600 }}>{tbl.rows.toLocaleString()}</td>
                        <td>
                          <div className={styles.progressBarWrap}>
                            <div className={styles.progressBg}>
                              <div
                                className={styles.progressFill}
                                style={{ width: `${Math.max(2, (tbl.rows / maxRows) * 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className={styles.purgeCard}>
              <div className={styles.purgeTitle}>⚠️ Purge Old Location Data</div>
              <div style={{ fontSize: '12px', color: '#8B4A4A', marginBottom: '14px' }}>
                This will delete device_locations older than {purgeDays} days. Use carefully.
              </div>
              <div className={styles.purgeRow}>
                <select
                  className={`${styles.formInput} ${styles.formSelect}`}
                  value={purgeDays}
                  onChange={(e) => setPurgeDays(Number(e.target.value))}
                  style={{ width: 'auto' }}
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
                <button
                  className={`${styles.btnSm} ${styles.btnDanger}`}
                  onClick={handlePurge}
                  disabled={purgeLoading}
                >
                  {purgeLoading ? 'Purging...' : 'Purge'}
                </button>
              </div>
              {purgeResult && (
                <div
                  style={{
                    marginTop: '12px',
                    fontSize: '13px',
                    color: purgeResult.includes('failed') ? '#FF5252' : '#00E676',
                  }}
                >
                  {purgeResult}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  function renderOtps() {
    return (
      <div className={styles.tabContent}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>OTP Logs</span>
          <span className={styles.sectionCount}>{otps.length} records</span>
        </div>

        {otpsLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner}></div>
            Loading OTP logs...
          </div>
        ) : otps.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔐</div>
            <div className={styles.emptyText}>No OTP records found</div>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.adminTable}>
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Sent At</th>
                </tr>
              </thead>
              <tbody>
                {otps.map((otp, i) => {
                  const status = getOtpStatus(otp)
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', color: '#00E676' }}>{otp.phone}</td>
                      <td>
                        {status === 'active' ? (
                          <span className={styles.otpCode}>{otp.code}</span>
                        ) : (
                          <span className={styles.expiredText}>{otp.code}</span>
                        )}
                      </td>
                      <td>
                        {status === 'used' && (
                          <span className={`${styles.badge} ${styles.badgeUsed}`}>Used</span>
                        )}
                        {status === 'active' && (
                          <span className={`${styles.badge} ${styles.badgeUnused}`}>Active</span>
                        )}
                        {status === 'expired' && (
                          <span className={`${styles.badge} ${styles.badgeWarning}`}>Expired</span>
                        )}
                      </td>
                      <td style={{ fontSize: '12px', color: '#5E8B6E' }}>
                        {formatRelativeOtp(otp.expires_at)}
                      </td>
                      <td style={{ color: '#5E8B6E', fontSize: '12px' }}>
                        {formatDate(otp.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  function renderBroadcast() {
    return (
      <div className={styles.tabContent}>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '14px', color: '#5E8B6E', lineHeight: 1.6 }}>
            Send a real-time message to all connected users via SSE (Server-Sent Events).
            Messages appear instantly on all active devices.
          </div>
        </div>

        <div className={styles.formCard}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Message</label>
            <textarea
              className={`${styles.formInput} ${styles.formTextarea}`}
              placeholder="Enter broadcast message..."
              value={bMessage}
              onChange={(e) => setBMessage(e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Type</label>
            <select
              className={`${styles.formInput} ${styles.formSelect}`}
              value={bType}
              onChange={(e) => setBType(e.target.value)}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="alert">Alert</option>
            </select>
          </div>
          <button
            className={`${styles.btnLg} ${styles.btnLgGreen}`}
            onClick={handleBroadcast}
            disabled={bLoading}
          >
            {bLoading ? 'Sending...' : 'Send Broadcast'}
          </button>
          {bResult && (
            <div
              className={`${styles.sendResult} ${bResult.ok ? styles.sendResultOk : styles.sendResultErr}`}
            >
              {bResult.text}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderSection() {
    switch (activeSection) {
      case 'dashboard':
        return renderDashboard()
      case 'users':
        return renderUsers()
      case 'circles':
        return renderCircles()
      case 'sos':
        return renderSos()
      case 'geofences':
        return renderGeofences()
      case 'system':
        return renderSystem()
      case 'otps':
        return renderOtps()
      case 'broadcast':
        return renderBroadcast()
      default:
        return renderDashboard()
    }
  }

  // ── Nav items ─────────────────────────────────────────────────────────────

  const navItems = [
    { key: 'dashboard', icon: '📊', label: 'Dashboard' },
    { key: 'users', icon: '👥', label: 'Users' },
    { key: 'circles', icon: '⭕', label: 'Circles' },
    { key: 'sos', icon: '🆘', label: 'SOS Alerts' },
    { key: 'geofences', icon: '🗺️', label: 'Geofences' },
    { key: 'system', icon: '⚙️', label: 'System' },
    { key: 'otps', icon: '🔐', label: 'OTP Logs' },
    { key: 'broadcast', icon: '📢', label: 'Broadcast' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.adminRoot}>
      <div className={`${styles.bgOrb} ${styles.bgOrb1}`}></div>
      <div className={`${styles.bgOrb} ${styles.bgOrb2}`}></div>

      {/* SIDEBAR */}
      <nav className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <div className={styles.sidebarLogoTitle}>
            <span className={styles.sidebarLiveDot}></span>
            GRAVITY
          </div>
          <div className={styles.sidebarLogoSub}>Admin Console</div>
        </div>

        <div className={styles.navList}>
          {navItems.map((item) => (
            <div
              key={item.key}
              className={`${styles.navItem} ${activeSection === item.key ? styles.navActive : ''}`}
              onClick={() => setActiveSection(item.key)}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            🚪 Logout
          </button>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <div className={styles.content}>
        <div className={styles.topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={styles.sidebarLiveDot}></span>
            <span className={styles.topBarTitle}>{sectionTitles[activeSection] || 'Admin'}</span>
          </div>
          <div className={styles.topBarMeta}>
            <span className={styles.topBarBadge}>
              Last refresh:{' '}
              {lastRefresh.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <button className={styles.refreshBtn} onClick={refresh}>
              🔄 Refresh
            </button>
          </div>
        </div>

        {renderSection()}
      </div>

      {/* TOAST */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'ok' ? styles.toastOk : styles.toastErr}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
