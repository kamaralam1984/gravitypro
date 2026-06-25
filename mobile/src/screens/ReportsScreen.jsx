// ReportsScreen — weekly activity summary for one child.
// Reads route.params.member (same shape as ChildTimelineScreen) and shows:
//   - totals (distance, time at home/school)
//   - per-day distance bars
//   - "Download CSV" (fetches with auth, saves to file, shares/opens it)
import React, { useCallback, useEffect, useState, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Share,
  Alert,
  Linking,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as FileSystem from 'expo-file-system'
import { useTheme } from '../theme/ThemeContext'
import {
  getWeeklyReport,
  getWeeklyCsvUrl,
  getCsvAuthHeaders,
} from '../services/reportsApi'

// ── Formatting helpers ──────────────────────────────────────────────────────
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

function dayLabel(dateKey) {
  const [y, mo, d] = dateKey.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]
}

export default function ReportsScreen({ route, navigation }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const member = route?.params?.member || {}
  const userId = member.id

  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    if (!userId) {
      setError('No child selected')
      setLoading(false)
      return
    }
    try {
      setError(null)
      const data = await getWeeklyReport(userId) // end defaults to today
      setReport(data)
    } catch (e) {
      setError(e?.message || 'Could not load report')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  // Download CSV: fetch with auth header, save to cache, share/open it.
  // Falls back to opening the URL via Linking if the fetch/save fails.
  const onDownloadCsv = useCallback(async () => {
    if (!userId || downloading) return
    setDownloading(true)
    let url
    try {
      url = await getWeeklyCsvUrl(userId)
      const headers = await getCsvAuthHeaders()
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const fileName = `weekly-report-${report?.end || 'latest'}.csv`
      const fileUri = (FileSystem.cacheDirectory || '') + fileName
      await FileSystem.writeAsStringAsync(fileUri, text, {
        encoding: FileSystem.EncodingType?.UTF8 || 'utf8',
      })
      await Share.share({ url: fileUri, title: fileName, message: fileName })
    } catch (e) {
      // Last resort: open the URL in the system browser (if we got one).
      if (url) {
        try { await Linking.openURL(url); return }
        catch (_) { /* fall through to alert */ }
      }
      Alert.alert('Download failed', e?.message || 'Could not export CSV')
    } finally {
      setDownloading(false)
    }
  }, [userId, downloading, report])

  const totals = report?.totals
  const days = report?.days || []
  const maxDist = Math.max(1, ...days.map((d) => d.distanceMeters || 0))

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={c.gradients?.hero || ['#042918', '#0A5C35']} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable hitSlop={12} onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Weekly Report</Text>
          <Text style={styles.headerSub}>{member.name || 'Child'} · last 7 days</Text>
        </View>
        <Pressable hitSlop={12} onPress={onDownloadCsv} disabled={downloading} style={styles.csvBtn}>
          {downloading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="download-outline" size={22} color="#fff" />
          )}
        </Pressable>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent || '#00E676'} />
          <Text style={styles.mutedText}>Loading report…</Text>
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
          {/* Totals */}
          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <Ionicons name="walk-outline" size={20} color={c.accent || '#00E676'} />
              <Text style={styles.totalValue}>{fmtDistance(totals?.totalDistanceMeters)}</Text>
              <Text style={styles.totalLabel}>Distance</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="home-outline" size={20} color="#10b981" />
              <Text style={styles.totalValue}>{fmtDuration(totals?.timeAtHomeSec)}</Text>
              <Text style={styles.totalLabel}>At Home</Text>
            </View>
            <View style={styles.totalCard}>
              <Ionicons name="school-outline" size={20} color="#f59e0b" />
              <Text style={styles.totalValue}>{fmtDuration(totals?.timeAtSchoolSec)}</Text>
              <Text style={styles.totalLabel}>At School</Text>
            </View>
          </View>

          {/* Per-day distance bars */}
          <Text style={styles.sectionTitle}>Daily distance</Text>
          <View style={styles.barChart}>
            {days.map((d) => {
              const pct = Math.round(((d.distanceMeters || 0) / maxDist) * 100)
              return (
                <View key={d.date} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: `${Math.max(2, pct)}%` }]} />
                  </View>
                  <Text style={styles.barLabel}>{dayLabel(d.date)}</Text>
                  <Text style={styles.barValue}>{fmtDistance(d.distanceMeters)}</Text>
                </View>
              )
            })}
          </View>

          {/* Per-day detail rows */}
          <Text style={styles.sectionTitle}>Breakdown</Text>
          {days.map((d) => (
            <View key={`row-${d.date}`} style={styles.dayRow}>
              <Text style={styles.dayRowDate}>
                {dayLabel(d.date)} · {d.date.slice(5)}
              </Text>
              <Text style={styles.dayRowMeta}>
                {fmtDistance(d.distanceMeters)} · {d.placesVisited} places · home {fmtDuration(d.timeAtHomeSec)} · school {fmtDuration(d.timeAtSchoolSec)}
              </Text>
            </View>
          ))}

          {/* Download CSV button */}
          <Pressable style={styles.downloadBtn} onPress={onDownloadCsv} disabled={downloading}>
            {downloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color="#fff" />
                <Text style={styles.downloadText}>Download CSV</Text>
              </>
            )}
          </Pressable>
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
    csvBtn: { padding: 6, marginLeft: 6 },
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
    totalsRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
    totalCard: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: c.bgCard || '#0F2518',
    },
    totalValue: { color: c.textPrimary || '#E8F5E9', fontSize: 16, fontWeight: '700', marginTop: 6 },
    totalLabel: { color: c.textMuted || '#5E8B6E', fontSize: 12, marginTop: 2 },
    sectionTitle: {
      color: c.textPrimary || '#E8F5E9',
      fontSize: 15,
      fontWeight: '700',
      marginTop: 20,
      marginBottom: 10,
    },
    barChart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      height: 160,
      backgroundColor: c.bgCard || '#0F2518',
      borderRadius: 14,
      padding: 12,
    },
    barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
    barTrack: { width: 14, flex: 1, justifyContent: 'flex-end', borderRadius: 7, overflow: 'hidden' },
    barFill: { width: '100%', backgroundColor: c.accent || '#00E676', borderRadius: 7 },
    barLabel: { color: c.textMuted || '#5E8B6E', fontSize: 11, marginTop: 6 },
    barValue: { color: c.textPrimary || '#E8F5E9', fontSize: 9, marginTop: 2 },
    dayRow: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border || 'rgba(0,230,118,0.15)',
    },
    dayRowDate: { color: c.textPrimary || '#E8F5E9', fontWeight: '600', fontSize: 14 },
    dayRowMeta: { color: c.textMuted || '#5E8B6E', fontSize: 12, marginTop: 3 },
    downloadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 24,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: c.accent || '#00E676',
    },
    downloadText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  })
