// MyTravelSummaryScreen — a child's own Travel Summary: distance, travel
// time, stay time, places visited, speed statistics, and a chronological
// "journey story". Composed entirely from the existing day-view endpoint
// (timelineAPI.getDay -> { segments, summary }) — no new backend endpoint.
// Always requests the LOGGED-IN user's own id (no member switcher).
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { useAuthStore } from '../store/authStore'
import { timelineAPI } from '../services/api'

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function fmtDistance(m) {
  const meters = Math.max(0, Math.round(m || 0))
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${meters} m`
}

function fmtTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function dateKey(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Turns ordered stay/trip segments into a plain-language narrative.
function buildJourneyStory(segments) {
  return segments.map((s, i) => {
    if (s.type === 'stay') {
      return {
        key: `stay-${i}`,
        icon: 'location',
        text: `Stayed at ${s.place || 'Unknown'} from ${fmtTime(s.arrive)} to ${s.leave ? fmtTime(s.leave) : 'now'} (${fmtDuration(s.durationSec)})`,
      }
    }
    return {
      key: `trip-${i}`,
      icon: 'navigate',
      text: `Traveled ${fmtDistance(s.distanceMeters)} in ${fmtDuration(s.durationSec)} (${fmtTime(s.startedAt)} → ${fmtTime(s.endedAt)})`,
    }
  })
}

// Avg/max speed (km/h) computed only from trip segments — stays are 0 km/h by definition.
function computeSpeedStats(segments) {
  const trips = segments.filter((s) => s.type === 'trip' && s.durationSec > 0)
  if (!trips.length) return { avgKmh: 0, maxKmh: 0 }
  let totalDist = 0
  let totalTime = 0
  let maxKmh = 0
  for (const t of trips) {
    totalDist += t.distanceMeters
    totalTime += t.durationSec
    const kmh = (t.distanceMeters / 1000) / (t.durationSec / 3600)
    if (kmh > maxKmh) maxKmh = kmh
  }
  const avgKmh = totalTime > 0 ? (totalDist / 1000) / (totalTime / 3600) : 0
  return { avgKmh, maxKmh }
}

const RANGES = [
  { label: 'Today', offset: 0 },
  { label: 'Yesterday', offset: -1 },
]

export default function MyTravelSummaryScreen({ navigation }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id

  const [rangeIdx, setRangeIdx] = useState(0)
  const date = useMemo(() => dateKey(RANGES[rangeIdx].offset), [rangeIdx])

  const [day, setDay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!userId) {
      setError('Not signed in')
      setLoading(false)
      return
    }
    try {
      setError(null)
      const data = await timelineAPI.getDay(userId, date)
      setDay(data)
    } catch (e) {
      setError(e?.message || 'Could not load travel summary')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId, date])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  const segments = day?.segments || []
  const summary = day?.summary
  const speed = useMemo(() => computeSpeedStats(segments), [segments])
  const story = useMemo(() => buildJourneyStory(segments), [segments])

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={c.gradients?.hero || ['#042918', '#0A5C35']} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable hitSlop={12} onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Travel Summary</Text>
          <Text style={styles.headerSub}>{RANGES[rangeIdx].label} · {date.slice(5)}</Text>
        </View>
      </LinearGradient>

      <View style={styles.tabs}>
        {RANGES.map((r, i) => (
          <Pressable key={r.label} style={[styles.tab, rangeIdx === i && styles.tabActive]} onPress={() => setRangeIdx(i)}>
            <Text style={[styles.tabText, rangeIdx === i && styles.tabTextActive]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent || '#00E676'} />
          <Text style={styles.mutedText}>Loading travel summary…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={c.danger || '#E53935'} />
          <Text style={styles.mutedText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <Ionicons name="walk-outline" size={20} color={c.accent || '#00E676'} />
              <Text style={styles.totalValue}>{fmtDistance(summary?.totalDistanceMeters)}</Text>
              <Text style={styles.totalLabel}>Distance</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="navigate-outline" size={20} color="#10b981" />
              <Text style={styles.totalValue}>{fmtDuration(summary?.movingSec)}</Text>
              <Text style={styles.totalLabel}>Travel Time</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="bed-outline" size={20} color="#f59e0b" />
              <Text style={styles.totalValue}>{fmtDuration(summary?.stillSec)}</Text>
              <Text style={styles.totalLabel}>Stay Time</Text>
            </View>
          </View>

          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <Ionicons name="pin-outline" size={20} color={c.accent || '#00E676'} />
              <Text style={styles.totalValue}>{summary?.placesVisited ?? 0}</Text>
              <Text style={styles.totalLabel}>Places Visited</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="speedometer-outline" size={20} color="#10b981" />
              <Text style={styles.totalValue}>{speed.avgKmh.toFixed(1)} km/h</Text>
              <Text style={styles.totalLabel}>Avg Speed</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="flash-outline" size={20} color="#f59e0b" />
              <Text style={styles.totalValue}>{speed.maxKmh.toFixed(1)} km/h</Text>
              <Text style={styles.totalLabel}>Top Speed</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Journey story</Text>
          {story.length === 0 ? (
            <Text style={styles.mutedText}>No movement recorded for this day.</Text>
          ) : (
            story.map((s) => (
              <View key={s.key} style={styles.storyRow}>
                <Ionicons name={s.icon} size={16} color={c.accent || '#00E676'} style={{ marginTop: 2 }} />
                <Text style={styles.storyText}>{s.text}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  )
}

const makeStyles = (c) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bgDeep || '#020C05' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingBottom: 14,
    },
    backBtn: { padding: 4, marginRight: 6 },
    headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
    headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
    tab: {
      paddingVertical: 6,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: c.bgCard || '#0F2518',
    },
    tabActive: { backgroundColor: c.accent || '#00E676' },
    tabText: { color: c.textMuted || '#5E8B6E', fontSize: 13, fontWeight: '600' },
    tabTextActive: { color: '#071a0f' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    mutedText: { color: c.textMuted || '#5E8B6E', marginTop: 10, textAlign: 'center' },
    retryBtn: {
      marginTop: 14,
      paddingVertical: 8,
      paddingHorizontal: 20,
      borderRadius: 8,
      backgroundColor: c.accent || '#00E676',
    },
    retryText: { color: '#fff', fontWeight: '600' },
    totalsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    totalCard: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: c.bgCard || '#0F2518',
    },
    totalValue: { color: c.textPrimary || '#E8F5E9', fontSize: 15, fontWeight: '700', marginTop: 6 },
    totalLabel: { color: c.textMuted || '#5E8B6E', fontSize: 11, marginTop: 2 },
    sectionTitle: {
      color: c.textPrimary || '#E8F5E9',
      fontSize: 15,
      fontWeight: '700',
      marginTop: 10,
      marginBottom: 10,
    },
    storyRow: {
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border || 'rgba(0,230,118,0.15)',
    },
    storyText: { color: c.textPrimary || '#E8F5E9', fontSize: 13, flex: 1, lineHeight: 18 },
  })
