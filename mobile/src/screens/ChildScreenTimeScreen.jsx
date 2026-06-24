import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { parentalAPI } from '../services/api'
import { useTheme } from '../theme/ThemeContext'

// ── Helpers ─────────────────────────────────────────────────────────────────

function toDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shiftDay(dateStr, delta) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + delta)
  return toDateStr(dt)
}

function isToday(dateStr) {
  return dateStr === toDateStr()
}

function formatLabelDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  if (!y) return dateStr
  const dt = new Date(y, (m || 1) - 1, d || 1)
  if (isToday(dateStr)) return 'Today'
  if (dateStr === shiftDay(toDateStr(), -1)) return 'Yesterday'
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// seconds -> "1h 23m" / "45m" / "30s"
function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// ── App row ─────────────────────────────────────────────────────────────────

function AppRow({ item, maxSeconds }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const secs = Number(item.foreground_seconds) || 0
  const opens = Number(item.opens) || 0
  const label = item.app_label || item.package_name || 'Unknown app'
  const pct = maxSeconds > 0 ? Math.max(0.02, secs / maxSeconds) : 0

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name="apps" size={18} color={c.accent} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.rowTime}>{formatDuration(secs)}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {opens} {opens === 1 ? 'open' : 'opens'} · {item.package_name}
        </Text>
      </View>
    </View>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function ChildScreenTimeScreen() {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const route = useRoute()
  const member = route.params?.member || {}
  const childId = member.id
  const childName = member.name || 'Child'

  const [date, setDate] = useState(toDateStr())
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(
    async (showSpinner = true) => {
      if (!childId) {
        setError('No child selected')
        setLoading(false)
        return
      }
      if (showSpinner) setLoading(true)
      setError(null)
      try {
        const res = await parentalAPI.getAppUsage(childId, date)
        const list = Array.isArray(res) ? res : Array.isArray(res?.apps) ? res.apps : []
        const norm = list
          .map((a) => ({
            package_name: String(a?.package_name ?? ''),
            app_label: String(a?.app_label ?? a?.package_name ?? ''),
            foreground_seconds: Number(a?.foreground_seconds) || 0,
            opens: Number(a?.opens) || 0,
          }))
          .filter((a) => a.package_name)
          .sort((a, b) => b.foreground_seconds - a.foreground_seconds)
        setApps(norm)
      } catch (e) {
        setError(e?.message || 'Could not load screen-time data')
        setApps([])
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [childId, date]
  )

  useEffect(() => {
    load(true)
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load(false)
  }, [load])

  const totalSeconds = useMemo(
    () => apps.reduce((sum, a) => sum + (Number(a.foreground_seconds) || 0), 0),
    [apps]
  )
  const maxSeconds = useMemo(
    () => apps.reduce((mx, a) => Math.max(mx, Number(a.foreground_seconds) || 0), 0),
    [apps]
  )

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />

      {/* Header */}
      <LinearGradient colors={c.gradients.hero} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Screen Time
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {childName}
            </Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        {/* Date selector */}
        <View style={styles.dateBar}>
          <Pressable onPress={() => setDate((d) => shiftDay(d, -1))} hitSlop={8} style={styles.dateArrow}>
            <Ionicons name="chevron-back" size={20} color={c.textSecondary} />
          </Pressable>
          <View style={styles.dateLabelWrap}>
            <Ionicons name="calendar-outline" size={15} color={c.accent} />
            <Text style={styles.dateLabel}>{formatLabelDate(date)}</Text>
          </View>
          <Pressable
            onPress={() => !isToday(date) && setDate((d) => shiftDay(d, 1))}
            hitSlop={8}
            style={[styles.dateArrow, isToday(date) && styles.dateArrowDisabled]}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={isToday(date) ? c.textMuted : c.textSecondary}
            />
          </Pressable>
        </View>

        {/* Day total */}
        <View style={styles.totalWrap}>
          <Text style={styles.totalLabel}>Total screen time</Text>
          <Text style={styles.totalValue}>{formatDuration(totalSeconds)}</Text>
        </View>
      </LinearGradient>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : error ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />
          }
        >
          <Ionicons name="alert-circle-outline" size={48} color={c.warning} />
          <Text style={styles.emptyTitle}>Couldn't load data</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <Pressable onPress={() => load(true)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </ScrollView>
      ) : apps.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />
          }
        >
          <Ionicons name="phone-portrait-outline" size={48} color={c.textMuted} />
          <Text style={styles.emptyTitle}>No screen-time data yet</Text>
          <Text style={styles.emptyText}>
            Needs the child device to report usage (requires native Usage Access).
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={(it, i) => it.package_name || String(i)}
          renderItem={({ item }) => <AppRow item={item} maxSeconds={maxSeconds} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />
          }
        />
      )}
    </View>
  )
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDark },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '700' },
  headerSub: { color: c.textSecondary, fontSize: 13, marginTop: 1 },

  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  dateArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bgGlass,
  },
  dateArrowDisabled: { opacity: 0.4 },
  dateLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateLabel: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },

  totalWrap: { alignItems: 'center', marginTop: 14 },
  totalLabel: { color: c.textSecondary, fontSize: 12, letterSpacing: 0.5 },
  totalValue: { color: c.accent, fontSize: 32, fontWeight: '800', marginTop: 2 },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 14 },
  emptyText: { color: c.textMuted, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  retryBtn: {
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: c.bgGlassStrong,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  retryText: { color: c.accent, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    backgroundColor: c.bgCard,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: c.bgGlass,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { flex: 1, color: c.textPrimary, fontSize: 15, fontWeight: '600', marginRight: 8 },
  rowTime: { color: c.accent, fontSize: 14, fontWeight: '700' },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.bgGlass,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: c.accentSoft },
  rowMeta: { color: c.textMuted, fontSize: 12, marginTop: 6 },
})
