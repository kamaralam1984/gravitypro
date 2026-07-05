import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import styles from './SmartPlaceDetail.module.css'
import type { SmartPlace } from './SmartPlaces'

declare const L: typeof import('leaflet')
type LeafletMap = InstanceType<typeof L.Map>

const API_BASE = window.location.origin + '/api/v1'
function getToken(): string | null { return localStorage.getItem('gravity_token') }
async function apiGet(path: string) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + token } })
  if (res.status === 401) { localStorage.clear(); return null }
  // Without this, a 404 (removed/merged place) left `place` null forever
  // with the loading spinner still showing, indistinguishable from a slow
  // network — the caller now gets null and can show a real "not found" state.
  if (!res.ok) return null
  return res.json()
}

interface Visit { id: string; arrivedAt: string; departedAt: string | null; durationSec: number | null; lat: number; lng: number }
interface WeekPoint { week: string; visits: number }
interface MonthPoint { month: string; visits: number }

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min`
  return `${m} min`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Bars<T extends { visits: number }>({ data, labelKey }: { data: T[]; labelKey: keyof T }) {
  const max = Math.max(1, ...data.map((d) => d.visits))
  return (
    <div className={styles.barsRow}>
      {data.map((d, i) => (
        <div key={i} className={styles.barCol} title={`${String(d[labelKey])}: ${d.visits} visits`}>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ height: `${(d.visits / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SmartPlaceDetail() {
  const { placeId } = useParams<{ placeId: string }>()
  const [searchParams] = useSearchParams()
  const userId = searchParams.get('userId') || ''

  const [place, setPlace] = useState<SmartPlace | null>(null)
  const [weeklyVisits, setWeeklyVisits] = useState<WeekPoint[]>([])
  const [monthlyVisits, setMonthlyVisits] = useState<MonthPoint[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  // Distinguishes "still fetching" from "fetch finished but place doesn't
  // exist" — without this, a 404 (removed/merged place, bad link) left
  // `place` null forever with the "Loading…" text shown indefinitely.
  const [loadFailed, setLoadFailed] = useState(false)

  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const mapInitedRef = useRef(false)

  useEffect(() => {
    if (!placeId || !userId) return
    (async () => {
      const data = await apiGet(`/smart-places/${userId}/${placeId}`)
      if (data?.place) {
        setPlace(data.place)
        setWeeklyVisits(data.weeklyVisits || [])
        setMonthlyVisits(data.monthlyVisits || [])
      } else {
        setLoadFailed(true)
      }
      const visitsData = await apiGet(`/smart-places/${userId}/${placeId}/visits?limit=20`)
      if (visitsData?.visits) setVisits(visitsData.visits)
    })()
  }, [placeId, userId])

  useEffect(() => {
    if (mapInitedRef.current || !mapRef.current || !place) return
    const init = () => {
      if (mapInitedRef.current || !mapRef.current || !place) return
      mapInitedRef.current = true
      const map = L.map(mapRef.current, { center: [place.lat, place.lng], zoom: 16, zoomControl: false, attributionControl: false })
      leafletMapRef.current = map
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map)
      L.marker([place.lat, place.lng], {
        icon: L.divIcon({ className: '', html: `<div style="font-size:26px;">${place.customIcon || place.icon}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).addTo(map)
      L.circle([place.lat, place.lng], { radius: 100, color: '#00E676', weight: 1, fillOpacity: 0.08 }).addTo(map)
      setTimeout(() => map.invalidateSize(), 100)
    }
    if ((window as unknown as { L?: unknown }).L) init()
    else {
      const check = setInterval(() => { if ((window as unknown as { L?: unknown }).L) { clearInterval(check); init() } }, 100)
    }
  }, [place])

  if (!place) {
    return (
      <div className={styles.pageWrap}>
        <div className={styles.appFrame}>
          <div className={styles.header}>
            <Link to={`/parent/smart-places?userId=${userId}`} className={styles.backBtn}>← Back</Link>
          </div>
          <div className={styles.emptyState}>{loadFailed ? 'Place not found — it may have been removed or merged.' : 'Loading…'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.pageWrap}>
      <div className={styles.appFrame}>
        <div className={styles.header}>
          <Link to={`/parent/smart-places?userId=${userId}`} className={styles.backBtn}>← Back</Link>
          <div className={styles.headerTitle}>{place.name}</div>
          <div style={{ width: 50 }} />
        </div>

        <div className={styles.titleRow}>
          <div className={styles.titleIcon}>{place.customIcon || place.icon}</div>
          <div>
            <div className={styles.titleName}>{place.name}</div>
            <div className={styles.titleCategory}>{place.category !== 'unknown' ? place.category : place.placeType}</div>
          </div>
        </div>

        <div className={styles.mapWrap}><div ref={mapRef} className={styles.map} /></div>

        <div className={styles.statsGrid}>
          <div className={styles.statTile}><div className={styles.statLabel}>Visits</div><div className={styles.statValue}>{place.visitCount}</div></div>
          <div className={styles.statTile}><div className={styles.statLabel}>Total Time</div><div className={styles.statValue}>{formatDuration(place.totalDurationSec)}</div></div>
          <div className={styles.statTile}><div className={styles.statLabel}>Avg Stay</div><div className={styles.statValue}>{formatDuration(Math.round(place.totalDurationSec / Math.max(1, place.visitCount)))}</div></div>
          <div className={styles.statTile}><div className={styles.statLabel}>Longest Stay</div><div className={styles.statValue}>{formatDuration(place.longestStaySec)}</div></div>
          <div className={styles.statTile}><div className={styles.statLabel}>Avg Arrival</div><div className={styles.statValue}>{place.avgArrival || '—'}</div></div>
          <div className={styles.statTile}><div className={styles.statLabel}>Avg Departure</div><div className={styles.statValue}>{place.avgDeparture || '—'}</div></div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>First / Last Visit</div>
          <div className={styles.rangeRow}>
            <span>{place.firstVisitAt ? formatDateTime(place.firstVisitAt) : '—'}</span>
            <span className={styles.rangeArrow}>→</span>
            <span>{place.lastVisitAt ? formatDateTime(place.lastVisitAt) : '—'}</span>
          </div>
        </div>

        {weeklyVisits.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Weekly Visits (last 12 weeks)</div>
            <Bars data={weeklyVisits} labelKey="week" />
          </div>
        )}
        {monthlyVisits.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Monthly Visits (last 12 months)</div>
            <Bars data={monthlyVisits} labelKey="month" />
          </div>
        )}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Visit Timeline</div>
          <div className={styles.visitList}>
            {visits.map((v) => (
              <div key={v.id} className={styles.visitRow}>
                <div className={styles.visitDot} />
                <div className={styles.visitBody}>
                  <div className={styles.visitTime}>{formatDateTime(v.arrivedAt)}{v.departedAt ? ` – ${new Date(v.departedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' (current)'}</div>
                  {v.durationSec != null && <div className={styles.visitDuration}>{formatDuration(v.durationSec)}</div>}
                </div>
                <Link
                  className={styles.visitRouteLink}
                  to={`/parent/timeline?userId=${userId}&date=${v.arrivedAt.slice(0, 10)}`}
                  title="View travel route for this day"
                >
                  🛣️
                </Link>
              </div>
            ))}
            {visits.length === 0 && <div className={styles.emptyState}>No visits recorded yet.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
