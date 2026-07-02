import styles from './StopCard.module.css'

export interface TimelineStop {
  id: string
  lat: number
  lng: number
  placeName: string
  placeType: 'safe_zone' | 'poi' | 'area' | 'road' | 'city' | 'unknown'
  address: string | null
  arrivedAt: string
  departedAt: string | null
  current: boolean
  durationSec: number
  pointCount: number
  safeZoneId: string | null
  photoCount: number
  videoCount: number
}

const ICONS: Record<TimelineStop['placeType'], string> = {
  safe_zone: '🏠',
  poi: '📍',
  area: '🏙️',
  road: '🛣️',
  city: '🏙️',
  unknown: '📍',
}

function iconFor(stop: TimelineStop): string {
  if (stop.placeType === 'safe_zone') {
    const n = stop.placeName.toLowerCase()
    if (n.includes('school') || n.includes('college')) return '🏫'
    if (n.includes('office') || n.includes('work')) return '🏢'
    if (n.includes('hospital') || n.includes('clinic')) return '🏥'
    if (n.includes('mosque')) return '🕌'
    if (n.includes('temple') || n.includes('mandir')) return '🛕'
    if (n.includes('church')) return '⛪'
    if (n.includes('home') || n.includes('house')) return '🏠'
    return '🏠'
  }
  return ICONS[stop.placeType] || '📍'
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min`
  return `${m} min`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface Props {
  stop: TimelineStop
  onClick?: (stop: TimelineStop) => void
}

export default function StopCard({ stop, onClick }: Props) {
  return (
    <button className={styles.card} onClick={() => onClick?.(stop)}>
      <div className={styles.iconCol}>
        <div className={styles.iconCircle}>{iconFor(stop)}</div>
        <div className={styles.iconLine} />
      </div>
      <div className={styles.body}>
        <div className={styles.headerRow}>
          <span className={styles.placeName}>{stop.placeName}</span>
          {stop.current && <span className={styles.currentBadge}>Current</span>}
        </div>
        {stop.current ? (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Arrived</span>
            <span className={styles.metaValue}>{formatTime(stop.arrivedAt)}</span>
          </div>
        ) : (
          <>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Arrival</span>
              <span className={styles.metaValue}>{formatTime(stop.arrivedAt)}</span>
              <span className={styles.metaLabel}>Departure</span>
              <span className={styles.metaValue}>{stop.departedAt ? formatTime(stop.departedAt) : '—'}</span>
            </div>
            <div className={styles.stayRow}>Stayed {formatDuration(stop.durationSec)}</div>
          </>
        )}
        {stop.address && <div className={styles.address}>{stop.address}</div>}
        <div className={styles.coords}>{stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}</div>
        {(stop.photoCount > 0 || stop.videoCount > 0) && (
          <div className={styles.mediaRow}>
            {stop.photoCount > 0 && <span>📷 {stop.photoCount} Photo{stop.photoCount !== 1 ? 's' : ''}</span>}
            {stop.videoCount > 0 && <span>🎥 {stop.videoCount} Video{stop.videoCount !== 1 ? 's' : ''}</span>}
          </div>
        )}
      </div>
    </button>
  )
}
