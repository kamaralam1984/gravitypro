import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import styles from './SmartPlaces.module.css'
import DateRangeFilter from '../components/DateRangeFilter'
import { rangeForPreset } from '../components/dateRange'
import type { DateRange } from '../components/dateRange'

const API_BASE = window.location.origin + '/api/v1'
function getToken(): string | null { return localStorage.getItem('gravity_token') }
async function apiGet(path: string) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + token } })
  if (res.status === 401) { localStorage.clear(); return null }
  if (!res.ok) return null
  return res.json()
}

export interface SmartPlace {
  id: string
  name: string
  category: string
  icon: string
  placeType: string
  lat: number
  lng: number
  visitCount: number
  totalDurationSec: number
  longestStaySec: number
  avgArrival: string | null
  avgDeparture: string | null
  firstVisitAt: string | null
  lastVisitAt: string | null
  isFavorite: boolean
  isPinned: boolean
  customIcon: string | null
  photoCount: number
}

interface Member { id: string; name: string; role: string }

function formatHours(sec: number): string {
  const h = sec / 3600
  return h >= 1 ? `${h.toFixed(h < 10 ? 1 : 0)} hrs` : `${Math.round(sec / 60)} min`
}

function formatLastVisit(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today ${time}`
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}

const SMART_PLACES_PRESETS: DateRange['preset'][] = ['today', 'yesterday', '7d', '30d', '90d', 'custom']

export default function SmartPlaces() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [members, setMembers] = useState<Member[]>([])
  const [userId, setUserId] = useState<string>(searchParams.get('userId') || '')
  const [places, setPlaces] = useState<SmartPlace[]>([])
  const [query, setQuery] = useState('')
  const [useDateFilter, setUseDateFilter] = useState(false)
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('30d'))
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    (async () => {
      const data = await apiGet('/circles')
      if (!data?.circles?.length) return
      const membersData = await apiGet('/circles/' + data.circles[0].id + '/members')
      if (membersData?.members) {
        setMembers(membersData.members)
        if (!userId) setUserId(membersData.members[0]?.id || '')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPlaces = useCallback(async () => {
    if (!userId) return
    // Guard against out-of-order responses when the user quickly changes
    // member/search/date-filter — an earlier, slower request resolving
    // after a newer one would otherwise silently overwrite fresher results.
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (useDateFilter) { params.set('from', range.from); params.set('to', range.to) }
      params.set('sort', 'visits')
      const data = await apiGet(`/smart-places/${userId}?${params.toString()}`)
      if (requestId !== requestIdRef.current) return
      setPlaces(data?.places || [])
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [userId, query, useDateFilter, range])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-dependency-change pattern
  useEffect(() => { loadPlaces() }, [loadPlaces])

  const selectedMember = members.find((m) => m.id === userId)
  const totalVisits = places.reduce((s, p) => s + p.visitCount, 0)
  const totalHours = places.reduce((s, p) => s + p.totalDurationSec, 0) / 3600

  return (
    <div className={styles.pageWrap}>
      <div className={styles.appFrame}>
        <div className={styles.header}>
          <Link to="/parent/panel" className={styles.backBtn}>← Back</Link>
          <div className={styles.headerTitle}>Smart Places</div>
          <div style={{ width: 50 }} />
        </div>

        {members.length > 1 && (
          <div className={styles.memberSwitcher}>
            {members.map((m) => (
              <button
                key={m.id}
                className={`${styles.memberPill} ${userId === m.id ? styles.memberPillActive : ''}`}
                onClick={() => setUserId(m.id)}
              >
                {m.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="Search Home, School, Office, Cafe…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className={styles.filterToggleRow}>
          <button className={styles.filterToggle} onClick={() => setUseDateFilter((v) => !v)}>
            {useDateFilter ? '✕ Clear date filter' : '📅 Filter by date'}
          </button>
        </div>
        {useDateFilter && (
          <div className={styles.filterRow}>
            <DateRangeFilter value={range} onChange={setRange} presets={SMART_PLACES_PRESETS} />
          </div>
        )}

        {places.length > 0 && (
          <div className={styles.analyticsRow}>
            <div className={styles.analyticsTile}>
              <div className={styles.analyticsValue}>{places.length}</div>
              <div className={styles.analyticsLabel}>Smart Places</div>
            </div>
            <div className={styles.analyticsTile}>
              <div className={styles.analyticsValue}>{totalVisits}</div>
              <div className={styles.analyticsLabel}>Total Visits</div>
            </div>
            <div className={styles.analyticsTile}>
              <div className={styles.analyticsValue}>{totalHours.toFixed(0)}h</div>
              <div className={styles.analyticsLabel}>Total Time</div>
            </div>
          </div>
        )}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Most Visited Places {selectedMember ? `· ${selectedMember.name.split(' ')[0]}` : ''}
          </div>
          {loading && <div className={styles.emptyState}>Loading…</div>}
          {!loading && places.length === 0 && (
            <div className={styles.emptyState}>
              No Smart Places learned yet. Places are automatically detected once your child visits somewhere at least 5 times, or spends 5+ hours there in total.
            </div>
          )}
          <div className={styles.placeGrid}>
            {places.map((p) => (
              <button key={p.id} className={styles.placeCard} onClick={() => navigate(`/parent/smart-places/${p.id}?userId=${userId}`)}>
                <div className={styles.placeIcon}>{p.customIcon || p.icon}</div>
                <div className={styles.placeBody}>
                  <div className={styles.placeName}>{p.name}</div>
                  <div className={styles.placeCategory}>{p.category !== 'unknown' ? p.category : p.placeType}</div>
                  <div className={styles.placeStatsRow}>
                    <span className={styles.placeStat}>{p.visitCount} Visits</span>
                    <span className={styles.placeStat}>{formatHours(p.totalDurationSec)}</span>
                  </div>
                  <div className={styles.placeLastVisit}>Last Visit: {formatLastVisit(p.lastVisitAt)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
