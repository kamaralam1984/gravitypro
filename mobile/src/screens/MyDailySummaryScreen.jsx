// MyDailySummaryScreen — a child's own Today's Summary (distance, travel
// time, stops, places visited, current location). Reuses the existing
// GET /timeline/:userId/summary endpoint (timelineAPI.getSummary) — no new
// backend work. Always requests the LOGGED-IN user's own id; there is no
// member switcher, so a child can never browse another family member's data
// (server-side canView() is the real enforcement — see routes/timeline.js).
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
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function MyDailySummaryScreen({ navigation }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const date = useMemo(() => todayKey(), [])

  const [summary, setSummary] = useState(null)
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
      const data = await timelineAPI.getSummary(userId, date)
      setSummary(data)
    } catch (e) {
      setError(e?.message || 'Could not load today’s summary')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId, date])

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  const places = summary?.placesVisited || []
  const current = places.length && !places[places.length - 1].departedAt
    ? places[places.length - 1]
    : null

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={c.gradients?.hero || ['#042918', '#0A5C35']} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable hitSlop={12} onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Daily Summary</Text>
          <Text style={styles.headerSub}>Today · {date.slice(5)}</Text>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent || '#00E676'} />
          <Text style={styles.mutedText}>Loading today’s summary…</Text>
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
              <Ionicons name="time-outline" size={20} color="#10b981" />
              <Text style={styles.totalValue}>{fmtDuration(summary?.travelSec)}</Text>
              <Text style={styles.totalLabel}>Travel Time</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="pause-circle-outline" size={20} color="#f59e0b" />
              <Text style={styles.totalValue}>{summary?.stopsCount ?? 0}</Text>
              <Text style={styles.totalLabel}>Stops</Text>
            </View>
          </View>

          {current && (
            <View style={styles.currentCard}>
              <Ionicons name="location" size={22} color={c.accent || '#00E676'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.currentTitle}>Currently at</Text>
                <Text style={styles.currentPlace}>{current.name}</Text>
                <Text style={styles.currentMeta}>Since {fmtTime(current.arrivedAt)}</Text>
              </View>
            </View>
          )}

          <Text style={styles.sectionTitle}>Places visited today</Text>
          {places.length === 0 ? (
            <Text style={styles.mutedText}>No stops recorded yet today.</Text>
          ) : (
            places.map((p, i) => (
              <View key={`${p.name}-${p.arrivedAt}-${i}`} style={styles.placeRow}>
                <Ionicons name="pin-outline" size={16} color={c.accent || '#00E676'} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeName}>{p.name}</Text>
                  <Text style={styles.placeMeta}>
                    {fmtTime(p.arrivedAt)} → {p.departedAt ? fmtTime(p.departedAt) : 'now'}
                  </Text>
                </View>
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
    totalsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    totalCard: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: c.bgCard || '#0F2518',
    },
    totalValue: { color: c.textPrimary || '#E8F5E9', fontSize: 16, fontWeight: '700', marginTop: 6 },
    totalLabel: { color: c.textMuted || '#5E8B6E', fontSize: 12, marginTop: 2 },
    currentCard: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      padding: 14,
      borderRadius: 14,
      backgroundColor: c.bgCard || '#0F2518',
      borderWidth: 1,
      borderColor: c.border || 'rgba(0,230,118,0.15)',
      marginBottom: 14,
    },
    currentTitle: { color: c.textMuted || '#5E8B6E', fontSize: 12 },
    currentPlace: { color: c.textPrimary || '#E8F5E9', fontSize: 15, fontWeight: '700', marginTop: 2 },
    currentMeta: { color: c.textMuted || '#5E8B6E', fontSize: 12, marginTop: 2 },
    sectionTitle: {
      color: c.textPrimary || '#E8F5E9',
      fontSize: 15,
      fontWeight: '700',
      marginTop: 6,
      marginBottom: 10,
    },
    placeRow: {
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border || 'rgba(0,230,118,0.15)',
    },
    placeName: { color: c.textPrimary || '#E8F5E9', fontWeight: '600', fontSize: 14 },
    placeMeta: { color: c.textMuted || '#5E8B6E', fontSize: 12, marginTop: 3 },
  })
