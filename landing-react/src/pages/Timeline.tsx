import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FixedSizeList } from 'react-window'
import styles from './Timeline.module.css'
import DateRangeFilter from '../components/DateRangeFilter'
import { rangeForPreset } from '../components/dateRange'
import type { DateRange } from '../components/dateRange'
import StopCard from '../components/StopCard'
import type { TimelineStop } from '../components/StopCard'
import RouteReplay from '../components/RouteReplay'
import type { RoutePoint } from '../components/RouteReplay'

declare const L: typeof import('leaflet')
type LWithCluster = typeof import('leaflet') & { markerClusterGroup: (opts?: object) => LeafletClusterGroup }
type LeafletMap = InstanceType<typeof L.Map>
type LeafletClusterGroup = { addLayer: (l: unknown) => void; clearLayers: () => void; addTo: (m: LeafletMap) => unknown }

const API_BASE = window.location.origin + '/api/v1'

function getToken(): string | null { return localStorage.getItem('gravity_token') }

// Child accounts must only ever see their own timeline — this is defense in
// depth (the real enforcement is server-side canView() in routes/timeline.js).
// We never fetch/store other family members' ids for a child viewer at all.
function getCurrentUser(): { id: string; account_type?: string } | null {
  try {
    const raw = localStorage.getItem('gravity_user')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function apiGet(path: string) {
  const token = getToken()
  if (!token) return null
  const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + token } })
  if (res.status === 401) { localStorage.clear(); return null }
  // Without this, an error body (403/404/500) was returned as if it were
  // real data — e.g. route.simplified was undefined on an error response,
  // which satisfied `!route.simplified` and rendered RouteReplay with
  // route.points undefined, crashing on points.length before its own
  // empty-check guard.
  if (!res.ok) return null
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
  if (res.status === 401) { localStorage.clear(); return null }
  if (!res.ok) return null
  return res.json()
}

interface Member { id: string; name: string; avatar_url?: string; role: string }

interface RouteResponse {
  points: RoutePoint[]
  start: RoutePoint | null
  end: RoutePoint | null
  simplified: boolean
  segments: RouteSegment[]
  nextCursor: string | null
}

interface RouteSegment {
  mode: string
  fromIdx: number
  toIdx: number
  avgSpeedKmh: number
  maxSpeedKmh: number
  durationSec: number
  distanceMeters: number
}

interface SnappedRoute {
  coordinates: [number, number][]
  distanceMeters: number
  durationSec: number | null
  snapped: boolean
}

interface SummaryResponse {
  date: string
  totalDistanceMeters: number
  travelSec: number
  stoppedSec: number
  stopsCount: number
  placesVisited: { name: string; arrivedAt: string; departedAt: string | null }[]
}

const MODE_COLORS: Record<string, string> = {
  stationary: '#5E8B6E',
  walking: '#29B6F6',
  cycling: '#FFB300',
  vehicle: '#00E676',
  highspeed: '#FF5252',
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min`
  return `${m} min`
}

export default function Timeline() {
  const [searchParams] = useSearchParams()

  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const mapInitedRef = useRef(false)
  const polylineLayerRef = useRef<InstanceType<typeof L.LayerGroup> | null>(null)
  const clusterGroupRef = useRef<LeafletClusterGroup | null>(null)
  const currentMarkerRef = useRef<InstanceType<typeof L.Marker> | null>(null)
  const timelineRequestIdRef = useRef(0)

  const currentUser = getCurrentUser()
  const isChildViewer = currentUser?.account_type === 'child'

  const [members, setMembers] = useState<Member[]>([])
  const [userId, setUserId] = useState<string>(
    isChildViewer && currentUser?.id ? currentUser.id : (searchParams.get('userId') || '')
  )
  // Supports deep-linking a specific day (e.g. from a Smart Place's Visit
  // Timeline "View travel route" link) via ?date=YYYY-MM-DD.
  const [range, setRange] = useState<DateRange>(() => {
    const dateParam = searchParams.get('date')
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return { preset: 'custom', from: dateParam, to: dateParam }
    }
    return rangeForPreset('today')
  })
  const [stops, setStops] = useState<TimelineStop[]>([])
  const [route, setRoute] = useState<RouteResponse | null>(null)
  const [snappedRoute, setSnappedRoute] = useState<SnappedRoute | null>(null)
  // In-session cache so toggling between already-viewed date ranges doesn't
  // re-hit /routing/path — cleared implicitly on page reload (not persisted).
  const snappedRouteCacheRef = useRef<Map<string, SnappedRoute>>(new Map())
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<RoutePoint | null>(null)
  const [loading, setLoading] = useState(false)
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null)

  const isSingleDay = range.from === range.to

  useEffect(() => {
    // Child viewers never fetch the circle member list — there is nothing to
    // switch to, and it avoids exposing other family members' ids/names.
    if (isChildViewer) {
      if (currentUser?.id) setUserId(currentUser.id)
      return
    }
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

  const loadTimelineData = useCallback(async () => {
    if (!userId) return
    // Guard against out-of-order responses: if the user quickly switches
    // member/date-range, an earlier (slower) request resolving after a
    // newer one would otherwise silently overwrite the fresher state with
    // stale data for a range/member no longer selected.
    const requestId = ++timelineRequestIdRef.current
    setLoading(true)
    try {
      const [stopsData, routeData] = await Promise.all([
        apiGet(`/timeline/${userId}/stops?from=${range.from}&to=${range.to}&limit=200`),
        apiGet(`/timeline/${userId}/route?from=${range.from}&to=${range.to}${isSingleDay ? '' : '&simplify=25'}`),
      ])
      if (requestId !== timelineRequestIdRef.current) return
      setStops(stopsData?.stops || [])
      setRoute(routeData || null)

      // Road-snap only single-day, non-simplified routes — multi-day/simplified
      // overviews use PostGIS ST_Simplify for a zoomed-out shape where
      // turn-by-turn snapping adds no visible value (see plan §5).
      if (isSingleDay && !routeData?.simplified && (routeData?.points?.length ?? 0) >= 2) {
        const cacheKey = `${userId}:${range.from}:${range.to}`
        const cached = snappedRouteCacheRef.current.get(cacheKey)
        if (cached) {
          setSnappedRoute(cached)
        } else {
          const snapped = await apiPost('/routing/path', { points: routeData.points })
          if (requestId !== timelineRequestIdRef.current) return
          if (snapped) {
            snappedRouteCacheRef.current.set(cacheKey, snapped)
            setSnappedRoute(snapped)
          } else {
            setSnappedRoute(null)
          }
        }
      } else {
        setSnappedRoute(null)
      }

      if (isSingleDay) {
        const summaryData = await apiGet(`/timeline/${userId}/summary?date=${range.to}`)
        if (requestId !== timelineRequestIdRef.current) return
        setSummary(summaryData || null)
      } else {
        setSummary(null)
      }
    } finally {
      if (requestId === timelineRequestIdRef.current) setLoading(false)
    }
  }, [userId, range, isSingleDay])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-dependency-change pattern
  useEffect(() => { loadTimelineData() }, [loadTimelineData])

  useEffect(() => {
    if (mapInitedRef.current || !mapRef.current) return
    const init = () => {
      if (mapInitedRef.current || !mapRef.current) return
      mapInitedRef.current = true
      const map = L.map(mapRef.current, { center: [20.5937, 78.9629], zoom: 5, zoomControl: false, attributionControl: false })
      leafletMapRef.current = map
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map)
      polylineLayerRef.current = L.layerGroup().addTo(map)
      const LC = L as unknown as LWithCluster
      if (LC.markerClusterGroup) clusterGroupRef.current = LC.markerClusterGroup()
      setTimeout(() => map.invalidateSize(), 100)
      setMapInstance(map)
    }
    if ((window as unknown as { L?: unknown }).L) init()
    else {
      const check = setInterval(() => { if ((window as unknown as { L?: unknown }).L) { clearInterval(check); init() } }, 100)
    }
  }, [])

  useEffect(() => {
    const map = leafletMapRef.current
    if (!map || !polylineLayerRef.current) return
    polylineLayerRef.current.clearLayers()
    if (currentMarkerRef.current) { currentMarkerRef.current.remove(); currentMarkerRef.current = null }

    if (!route?.points?.length) return
    const latlngs = route.points.map((p) => [p.lat, p.lng] as [number, number])

    // Road-snapped base line, drawn under the (still mode-colored) segment
    // overlay below — gives the "follows roads" look without losing the
    // walking/cycling/vehicle color-coding. Falls back to nothing extra when
    // OSRM was unavailable (snapped:false) or snapping wasn't requested.
    if (snappedRoute?.snapped && snappedRoute.coordinates.length >= 2) {
      L.polyline(snappedRoute.coordinates, { color: '#00E676', weight: 6, opacity: 0.35 }).addTo(polylineLayerRef.current)
    }

    if (route.simplified || !route.segments.length) {
      L.polyline(latlngs, { color: '#00E676', weight: 4, opacity: 0.85 }).addTo(polylineLayerRef.current)
    } else {
      for (const seg of route.segments) {
        const segPoints = route.points.slice(seg.fromIdx, seg.toIdx + 1).map((p) => [p.lat, p.lng] as [number, number])
        if (segPoints.length < 2) continue
        L.polyline(segPoints, { color: MODE_COLORS[seg.mode] || '#00E676', weight: 4, opacity: 0.85 })
          .addTo(polylineLayerRef.current!)
          .on('click', () => {
            const midIdx = Math.floor((seg.fromIdx + seg.toIdx) / 2)
            setSelectedPoint(route.points[midIdx])
          })
      }
    }

    const arrowEvery = Math.max(1, Math.floor(route.points.length / 20))
    for (let i = arrowEvery; i < route.points.length - 1; i += arrowEvery) {
      const a = route.points[i - 1]
      const b = route.points[i]
      const bearing = (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI
      const icon = L.divIcon({
        className: '',
        html: `<div style="transform:rotate(${bearing}deg);color:#00E676;font-size:14px;">▲</div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      L.marker([b.lat, b.lng], { icon, interactive: false }).addTo(polylineLayerRef.current!)
    }

    if (route.start) {
      L.marker([route.start.lat, route.start.lng], {
        icon: L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:#29B6F6;border:2px solid #fff;"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
      }).bindPopup('Start').addTo(polylineLayerRef.current)
    }
    if (route.end) {
      const marker = L.marker([route.end.lat, route.end.lng], {
        icon: L.divIcon({ className: '', html: `<div style="width:18px;height:18px;border-radius:50%;background:#00E676;border:3px solid #fff;box-shadow:0 0 10px rgba(0,230,118,0.7);"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).bindPopup(isSingleDay && range.to === new Date().toISOString().slice(0, 10) ? 'Current Location' : 'End').addTo(polylineLayerRef.current)
      currentMarkerRef.current = marker
    }

    if (latlngs.length >= 2) map.fitBounds(latlngs, { padding: [40, 40] })
    else if (latlngs.length === 1) map.setView(latlngs[0], 15)
  }, [route, snappedRoute, isSingleDay, range.to])

  useEffect(() => {
    const map = leafletMapRef.current
    if (!map) return
    clusterGroupRef.current?.clearLayers()
    for (const stop of stops) {
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({ className: '', html: `<div style="background:#0D1F13;border:2px solid #00E676;border-radius:8px;padding:2px 6px;font-size:11px;color:#00E676;font-weight:700;white-space:nowrap;">${stop.placeName}</div>`, iconSize: [0, 0] }),
      })
      if (!isSingleDay && clusterGroupRef.current) {
        clusterGroupRef.current.addLayer(marker)
      } else {
        marker.addTo(map)
      }
    }
    if (!isSingleDay && clusterGroupRef.current) clusterGroupRef.current.addTo(map)
  }, [stops, isSingleDay])

  const zoomToRoute = () => {
    const map = leafletMapRef.current
    if (!map || !route?.points?.length) return
    map.fitBounds(route.points.map((p) => [p.lat, p.lng]) as [number, number][], { padding: [40, 40] })
  }

  const resolveAddressForPoint = useCallback((lat: number, lng: number) => {
    let best: TimelineStop | null = null
    let bestD = Infinity
    for (const s of stops) {
      const d = Math.hypot(s.lat - lat, s.lng - lng)
      if (d < bestD) { bestD = d; best = s }
    }
    return best?.address || best?.placeName || ''
  }, [stops])

  const selectedMember = members.find((m) => m.id === userId)

  const rowRenderer = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <div style={{ ...style, paddingBottom: 10 }}>
      <StopCard stop={stops[index]} onClick={(s) => leafletMapRef.current?.setView([s.lat, s.lng], 16)} />
    </div>
  )

  return (
    <div className={styles.pageWrap}>
      <div className={styles.appFrame}>
        <div className={styles.header}>
          <Link to="/parent/panel" className={styles.backBtn}>← Back</Link>
          <div className={styles.headerTitle}>Travel Timeline</div>
          <div style={{ width: 50 }} />
        </div>

        {!isChildViewer && members.length > 1 && (
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

        <div className={styles.filterRow}>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>

        <div className={styles.mapWrap}>
          <div ref={mapRef} className={styles.map} />
          <div className={styles.mapControls}>
            <button className={styles.mapCtrlBtn} onClick={zoomToRoute}>⤢ Fit Route</button>
          </div>
          {loading && <div className={styles.mapLoading}>Loading…</div>}
        </div>

        {isSingleDay && route && !route.simplified && (
          <div className={styles.section}>
            <RouteReplay
              map={mapInstance}
              points={route.points}
              resolveAddress={resolveAddressForPoint}
              snappedPath={snappedRoute?.snapped ? snappedRoute.coordinates : undefined}
            />
          </div>
        )}

        {selectedPoint && (
          <div className={styles.detailCard}>
            <div className={styles.detailHeader}>
              <span>Route Point Detail</span>
              <button className={styles.detailClose} onClick={() => setSelectedPoint(null)}>✕</button>
            </div>
            <div className={styles.detailGrid}>
              <div><span className={styles.detailLabel}>Time</span><span>{new Date(selectedPoint.ts).toLocaleString()}</span></div>
              <div><span className={styles.detailLabel}>Speed</span><span>{selectedPoint.speed != null ? `${Math.round(selectedPoint.speed * 3.6)} km/h` : '—'}</span></div>
              <div><span className={styles.detailLabel}>Address</span><span>{resolveAddressForPoint(selectedPoint.lat, selectedPoint.lng) || '—'}</span></div>
              <div><span className={styles.detailLabel}>Accuracy</span><span>{selectedPoint.accuracy != null ? `±${Math.round(selectedPoint.accuracy)}m` : '—'}</span></div>
              <div><span className={styles.detailLabel}>Heading</span><span>{selectedPoint.bearing != null ? `${Math.round(selectedPoint.bearing)}°` : '—'}</span></div>
              <div><span className={styles.detailLabel}>Altitude</span><span>{selectedPoint.altitude != null ? `${Math.round(selectedPoint.altitude)}m` : '—'}</span></div>
            </div>
          </div>
        )}

        {summary && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Daily Summary</div>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Distance</div>
                <div className={styles.summaryValue}>{(summary.totalDistanceMeters / 1000).toFixed(1)} km</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Travel Time</div>
                <div className={styles.summaryValue}>{formatDuration(summary.travelSec)}</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Stopped</div>
                <div className={styles.summaryValue}>{formatDuration(summary.stoppedSec)}</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>Stops</div>
                <div className={styles.summaryValue}>{summary.stopsCount}</div>
              </div>
            </div>
            {summary.placesVisited.length > 0 && (
              <div className={styles.placesVisited}>
                {summary.placesVisited.map((p, i) => (
                  <span key={i} className={styles.placeChip}>{p.name}{i < summary.placesVisited.length - 1 ? ' →' : ''}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Timeline {selectedMember ? `· ${selectedMember.name.split(' ')[0]}` : ''}
          </div>
          {stops.length === 0 && !loading && (
            <div className={styles.emptyState}>No stops detected for this range yet.</div>
          )}
          {stops.length > 0 && (
            stops.length > 20 ? (
              <FixedSizeList
                height={Math.min(600, stops.length * 130)}
                itemCount={stops.length}
                itemSize={130}
                width="100%"
              >
                {rowRenderer}
              </FixedSizeList>
            ) : (
              <div className={styles.stopList}>
                {stops.map((s) => (
                  <StopCard key={s.id} stop={s} onClick={(stop) => leafletMapRef.current?.setView([stop.lat, stop.lng], 16)} />
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
