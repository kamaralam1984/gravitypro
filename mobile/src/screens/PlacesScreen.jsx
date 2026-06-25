// PlacesScreen — "Places History" for one child.
// Reads route.params.member (same shape as ChildTimelineScreen / ReportsScreen)
// and lists every named place the member visits (Home, School, Tuition, …)
// with total dwell time, visit count and last-visited, over the last N days.
//
// ACCURACY: place names + categories come straight from the backend, which
// derives them from the REAL safe_zones rows. Stays that matched no zone are
// shown as a single "Other places" row with coordinates — never a fake name.
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
import { getPlaces } from '../services/placesApi'

// ── Category → icon mapping (Ionicons) ──────────────────────────────────────
const CATEGORY_ICON = {
  home: 'home',
  school: 'school',
  tuition: 'book',
  playground: 'football',
  music: 'musical-notes',
  dance: 'musical-note',
  other: 'location',
}
function iconFor(category) {
  return CATEGORY_ICON[(category || 'other').toLowerCase()] || CATEGORY_ICON.other
}

// ── Formatting helpers ──────────────────────────────────────────────────────
function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function fmtLastVisit(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const isYest =
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate()
  if (isYest) return `Yesterday ${time}`
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${date} ${time}`
}

const RANGES = [7, 30]

export default function PlacesScreen({ route, navigation }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const member = route?.params?.member || {}
  const userId = member.id
  const name = member.name || 'Child'

  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!userId) {
      setError('No child selected')
      setLoading(false)
      return
    }
    try {
      setError(null)
      const res = await getPlaces(userId, days)
      setData(res)
    } catch (e) {
      setError(e?.error || e?.message || 'Could not load places')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId, days])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  const places = data?.places || []

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />
      <LinearGradient
        colors={['#042918', '#0A5C35', '#020C05']}
        style={[styles.header, { paddingTop: insets.top + 14 }]}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={c.textWhite} />
        </Pressable>
        <Text style={styles.headerTitle}>Places History</Text>
        <Text style={styles.headerSub}>{name}</Text>

        {/* Day-range selector */}
        <View style={styles.rangeRow}>
          {RANGES.map((r) => {
            const active = r === days
            return (
              <Pressable
                key={r}
                onPress={() => setDays(r)}
                style={[styles.rangeChip, active && styles.rangeChipActive]}
              >
                <Text style={[styles.rangeText, active && styles.rangeTextActive]}>
                  {r} days
                </Text>
              </Pressable>
            )
          })}
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={styles.muted}>Loading places…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={c.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={onRefresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 30 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />
          }
        >
          {places.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="map-outline" size={48} color={c.textMuted} />
              <Text style={styles.emptyTitle}>No places yet</Text>
              <Text style={styles.muted}>
                No stays recorded in the last {days} days. Places appear once
                {' '}{name} dwells at a location.
              </Text>
            </View>
          ) : (
            places.map((p, i) => (
              <View key={p.zoneId != null ? `z${p.zoneId}` : `other${i}`} style={styles.card}>
                <LinearGradient colors={c.gradients.card} style={styles.cardGrad}>
                  <View style={styles.iconWrap}>
                    <Ionicons
                      name={iconFor(p.category)}
                      size={24}
                      color={p.zoneId != null ? c.accent : c.textMuted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={styles.metaRow}>
                      <Ionicons name="time-outline" size={13} color={c.textSecondary} />
                      <Text style={styles.metaText}>{fmtDuration(p.totalDurationSec)}</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.metaText}>
                        {p.visits} {p.visits === 1 ? 'visit' : 'visits'}
                      </Text>
                    </View>
                    <Text style={styles.lastVisit}>Last: {fmtLastVisit(p.lastVisit)}</Text>
                    {p.zoneId == null && p.lat != null && p.lng != null ? (
                      <Text style={styles.coords}>
                        {Number(p.lat).toFixed(4)}, {Number(p.lng).toFixed(4)}
                      </Text>
                    ) : null}
                  </View>
                </LinearGradient>
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
    container: { flex: 1, backgroundColor: c.bgDeep },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 18,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
    },
    back: { width: 36, height: 36, justifyContent: 'center' },
    headerTitle: { fontSize: 24, fontWeight: '800', color: c.textWhite, marginTop: 4 },
    headerSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
    rangeRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
    rangeChip: {
      paddingHorizontal: 16,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    rangeChipActive: { backgroundColor: c.accent },
    rangeText: { color: c.textWhite, fontSize: 13, fontWeight: '600' },
    rangeTextActive: { color: '#042918', fontWeight: '800' },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    muted: { color: c.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    errorText: { color: c.danger, fontSize: 15, textAlign: 'center' },
    retryBtn: {
      marginTop: 6,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: c.bgGlass,
      borderWidth: 1,
      borderColor: c.border,
    },
    retryText: { color: c.accent, fontWeight: '700' },

    scroll: { padding: 16, gap: 12 },
    emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
    emptyTitle: { color: c.textWhite, fontSize: 17, fontWeight: '700' },

    card: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    cardGrad: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
    iconWrap: {
      width: 48,
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.bgGlass,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: c.textWhite },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    metaText: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    dot: { color: c.textMuted, fontSize: 13 },
    lastVisit: { fontSize: 12, color: c.textMuted, marginTop: 3 },
    coords: { fontSize: 11, color: c.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
  })
