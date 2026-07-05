import { useEffect, useRef, useState, useCallback } from 'react'
import styles from './RouteReplay.module.css'

export interface RoutePoint {
  lat: number
  lng: number
  ts: string // ISO timestamp
  speed?: number | null
  bearing?: number | null
  altitude?: number | null
  accuracy?: number | null
}

declare const L: typeof import('leaflet')
type LeafletMap = InstanceType<typeof L.Map>
type LeafletMarker = InstanceType<typeof L.Marker>

interface Props {
  map: LeafletMap | null
  points: RoutePoint[]
  // Resolves the nearest known address for the HUD during playback — passed
  // in rather than fetched here, since Timeline.tsx already has stop/geocode
  // context and this keeps RouteReplay a pure animation component.
  resolveAddress?: (lat: number, lng: number) => string
}

type PlayState = 'idle' | 'playing' | 'paused'

const SPEED_OPTIONS = [1, 2, 4] as const

export default function RouteReplay({ map, points = [], resolveAddress }: Props) {
  const [playState, setPlayState] = useState<PlayState>('idle')
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 4>(1)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [cursorIdx, setCursorIdx] = useState(0)

  const markerRef = useRef<LeafletMarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const cursorRef = useRef(0)

  const totalDurationMs = points.length > 1
    ? new Date(points[points.length - 1].ts).getTime() - new Date(points[0].ts).getTime()
    : 0

  useEffect(() => {
    if (!map || !points.length) return
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#00E676;border:3px solid #fff;box-shadow:0 0 12px rgba(0,230,118,0.8);"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    })
    const marker = L.marker([points[0].lat, points[0].lng], { icon, zIndexOffset: 1000 }).addTo(map)
    markerRef.current = marker
    return () => { marker.remove(); markerRef.current = null }
  }, [map, points])

  const applyElapsed = useCallback((ms: number) => {
    if (!points.length) return
    const clamped = Math.max(0, Math.min(ms, totalDurationMs))
    const targetTs = new Date(points[0].ts).getTime() + clamped

    let i = cursorRef.current
    while (i < points.length - 1 && new Date(points[i + 1].ts).getTime() <= targetTs) i++
    while (i > 0 && new Date(points[i].ts).getTime() > targetTs) i--
    cursorRef.current = i
    setCursorIdx(i)

    const a = points[i]
    const b = points[Math.min(i + 1, points.length - 1)]
    const aTs = new Date(a.ts).getTime()
    const bTs = new Date(b.ts).getTime()
    const frac = bTs > aTs ? (targetTs - aTs) / (bTs - aTs) : 0
    const lat = a.lat + (b.lat - a.lat) * frac
    const lng = a.lng + (b.lng - a.lng) * frac
    markerRef.current?.setLatLng([lat, lng])
    setElapsedMs(clamped)
  }, [points, totalDurationMs])

  const elapsedMsRef = useRef(0)
  useEffect(() => { elapsedMsRef.current = elapsedMs }, [elapsedMs])

  useEffect(() => {
    if (playState !== 'playing') {
      lastFrameRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = (now: number) => {
      if (lastFrameRef.current == null) lastFrameRef.current = now
      const dt = now - lastFrameRef.current
      lastFrameRef.current = now
      const next = elapsedMsRef.current + dt * speedMultiplier
      if (next >= totalDurationMs) {
        applyElapsed(totalDurationMs)
        setPlayState('paused')
        return
      }
      applyElapsed(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playState, speedMultiplier])

  const play = () => { if (!points.length) return; setPlayState('playing') }
  const pause = () => setPlayState('paused')
  const resume = () => setPlayState('playing')
  const restart = () => { cursorRef.current = 0; applyElapsed(0); setPlayState('playing') }

  if (!points.length || points.length < 2) return null

  const current = points[cursorIdx]
  const currentSpeedKmh = current?.speed != null ? Math.round(current.speed * 3.6) : null
  const address = current && resolveAddress ? resolveAddress(current.lat, current.lng) : null

  return (
    <div className={styles.wrap}>
      {(playState === 'playing' || playState === 'paused') && current && (
        <div className={styles.hud}>
          <div className={styles.hudRow}>
            <span className={styles.hudTime}>{new Date(current.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            {currentSpeedKmh != null && <span className={styles.hudSpeed}>{currentSpeedKmh} km/h</span>}
          </div>
          {address && <div className={styles.hudAddress}>{address}</div>}
        </div>
      )}

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${totalDurationMs ? (elapsedMs / totalDurationMs) * 100 : 0}%` }} />
      </div>

      <div className={styles.controls}>
        {playState === 'idle' && <button className={styles.playBtn} onClick={play}>▶ Play</button>}
        {playState === 'playing' && <button className={styles.playBtn} onClick={pause}>⏸ Pause</button>}
        {playState === 'paused' && <button className={styles.playBtn} onClick={resume}>▶ Resume</button>}
        <button className={styles.iconBtn} onClick={restart} title="Restart">⟲</button>
        <div className={styles.speedGroup}>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={`${styles.speedBtn} ${speedMultiplier === s ? styles.speedBtnActive : ''}`}
              onClick={() => setSpeedMultiplier(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
