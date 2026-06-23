import React, { useEffect, useState, useMemo, useCallback } from 'react'
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
import { timelineAPI } from '../services/api'
import { Colors, Gradients } from '../theme/colors'
import { formatDistance } from '../components/FamilyMap'

// ── Date helpers ──────────────────────────────────────────────────────────────

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Local-time YYYY-MM-DD (avoids UTC off-by-one from toISOString()).
function toDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatHeaderDate(key) {
  const d = parseDateKey(key)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// "2h 15m" / "18 min" / "45s"
function formatDuration(sec) {
  if (sec == null || sec < 0) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m} min`
  return `${s}s`
}

// Build a month grid (weeks of 7), null padding for leading/trailing blanks.
function buildMonthGrid(viewMonth) {
  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lead = first.getDay()
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// ── Calendar ──────────────────────────────────────────────────────────────────

function Calendar({ viewMonth, selectedKey, markedDays, onPrevMonth, onNextMonth, onSelect }) {
  const weeks = useMemo(() => buildMonthGrid(viewMonth), [viewMonth])
  const todayKey = toDateKey(new Date())

  return (
    <View style={styles.calCard}>
      <View style={styles.calHeader}>
        <Pressable hitSlop={12} onPress={onPrevMonth} style={styles.calNavBtn}>
          <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Text style={styles.calTitle}>
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </Text>
        <Pressable hitSlop={12} onPress={onNextMonth} style={styles.calNavBtn}>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.calWeekRow}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={styles.calWeekday}>{w}</Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.calWeekRow}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={styles.calCell} />
            const key = toDateKey(day)
            const isSelected = key === selectedKey
            const isToday = key === todayKey
            const hasData = markedDays.has(key)
            return (
              <Pressable
                key={di}
                style={styles.calCell}
                onPress={() => onSelect(key)}>
                <View style={[styles.calDay, isSelected && styles.calDaySelected]}>
                  <Text
                    style={[
                      styles.calDayText,
                      isToday && !isSelected && styles.calDayToday,
                      isSelected && styles.calDayTextSelected,
                    ]}>
                    {day.getDate()}
                  </Text>
                </View>
                {hasData && !isSelected ? <View style={styles.calDot} /> : <View style={styles.calDotSpacer} />}
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

// ── Summary header ────────────────────────────────────────────────────────────

function SummaryStat({ icon, value, label }) {
  return (
    <View style={styles.summaryStat}>
      <Ionicons name={icon} size={18} color={Colors.accent} />
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  )
}

function DaySummary({ summary }) {
  if (!summary) return null
  return (
    <LinearGradient colors={Gradients.card} style={styles.summaryCard}>
      <SummaryStat
        icon="navigate"
        value={formatDistance(summary.totalDistanceMeters || 0)}
        label="distance"
      />
      <View style={styles.summaryDivider} />
      <SummaryStat
        icon="location"
        value={String(summary.placesVisited ?? 0)}
        label={summary.placesVisited === 1 ? 'place' : 'places'}
      />
      <View style={styles.summaryDivider} />
      <SummaryStat
        icon="walk"
        value={formatDuration(summary.movingSec || 0) || '0'}
        label="moving"
      />
      <View style={styles.summaryDivider} />
      <SummaryStat
        icon="bed"
        value={formatDuration(summary.stillSec || 0) || '0'}
        label="still"
      />
    </LinearGradient>
  )
}

// ── Segments ──────────────────────────────────────────────────────────────────

function StayCard({ seg, isFirst, isLast }) {
  const title = seg.place || (seg.zoneId ? 'Saved place' : 'Stayed here')
  const arrived = formatClock(seg.arrive)
  const left = formatClock(seg.leave)
  let times = ''
  if (arrived && left) times = `arrived ${arrived}, left ${left}`
  else if (arrived) times = `arrived ${arrived}`
  else if (left) times = `left ${left}`

  return (
    <View style={styles.segRow}>
      <View style={styles.rail}>
        <View style={[styles.railLine, isFirst && styles.railLineHidden]} />
        <View style={styles.stayNode}>
          <Ionicons name="location" size={14} color={Colors.bgDeep} />
        </View>
        <View style={[styles.railLine, isLast && styles.railLineHidden]} />
      </View>
      <LinearGradient colors={Gradients.card} style={styles.stayCard}>
        <Text style={styles.stayTitle} numberOfLines={1}>📍 {title}</Text>
        <Text style={styles.staySub}>
          {formatDuration(seg.durationSec)}
          {times ? ` · ${times}` : ''}
        </Text>
      </LinearGradient>
    </View>
  )
}

function TripRow({ seg }) {
  const dist = formatDistance(seg.distanceMeters || 0)
  const dur = formatDuration(seg.durationSec)
  return (
    <View style={styles.segRow}>
      <View style={styles.rail}>
        <View style={styles.railLineDashed} />
        <View style={styles.tripNode}>
          <Ionicons name="walk" size={12} color={Colors.accent} />
        </View>
        <View style={styles.railLineDashed} />
      </View>
      <View style={styles.tripBody}>
        <Text style={styles.tripText}>
          🚶 moved {dist}
          {dur ? ` · ${dur}` : ''}
        </Text>
      </View>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChildTimelineScreen({ route, navigation }) {
  const insets = useSafeAreaInsets()
  const member = route?.params?.member || {}
  const userId = member.id

  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [selectedKey, setSelectedKey] = useState(() => toDateKey(new Date()))
  const [markedDays, setMarkedDays] = useState(new Set())
  const [day, setDay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  // Fetch which days in the visible month have data.
  const loadDays = useCallback(async () => {
    if (!userId) return
    try {
      const res = await timelineAPI.getDays(userId, toMonthKey(viewMonth))
      setMarkedDays(new Set(res?.days || []))
    } catch {
      // Non-fatal: just leave dots unmarked.
    }
  }, [userId, viewMonth])

  // Fetch the selected day's timeline.
  const loadDay = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      setError('No child selected')
      return
    }
    setError(null)
    try {
      const res = await timelineAPI.getDay(userId, selectedKey)
      setDay(res || { segments: [], summary: null })
    } catch (e) {
      setError('Could not load timeline')
      setDay(null)
    }
  }, [userId, selectedKey])

  useEffect(() => { loadDays() }, [loadDays])

  useEffect(() => {
    let active = true
    setLoading(true)
    loadDay().finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadDay])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadDays(), loadDay()])
    setRefreshing(false)
  }, [loadDays, loadDay])

  const onPrevMonth = useCallback(() => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }, [])
  const onNextMonth = useCallback(() => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }, [])

  const onSelectDay = useCallback((key) => {
    setSelectedKey(key)
    const d = parseDateKey(key)
    if (d.getMonth() !== viewMonth.getMonth() || d.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }, [viewMonth])

  const segments = day?.segments || []

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={Gradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable hitSlop={12} onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {member.name ? `${member.name}'s Timeline` : 'Timeline'}
            </Text>
            <Text style={styles.headerSub}>{formatHeaderDate(selectedKey)}</Text>
          </View>
          <View style={styles.backBtn} />
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }>
        <Calendar
          viewMonth={viewMonth}
          selectedKey={selectedKey}
          markedDays={markedDays}
          onPrevMonth={onPrevMonth}
          onNextMonth={onNextMonth}
          onSelect={onSelectDay}
        />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={styles.mutedText}>Loading timeline…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.mutedText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={onRefresh}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <DaySummary summary={day?.summary} />

            {segments.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="map-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.mutedText}>No activity recorded for this day</Text>
              </View>
            ) : (
              <View style={styles.timeline}>
                {segments.map((seg, i) => {
                  const key = `${seg.type}-${i}`
                  if (seg.type === 'trip') return <TripRow key={key} seg={seg} />
                  return (
                    <StayCard
                      key={key}
                      seg={seg}
                      isFirst={i === 0}
                      isLast={i === segments.length - 1}
                    />
                  )
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const NODE = 28

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTextWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { color: Colors.textWhite, fontSize: 18, fontWeight: '700' },
  headerSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  // Calendar
  calCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 16,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  calNavBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bgGlass,
  },
  calTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  calWeekRow: { flexDirection: 'row' },
  calWeekday: {
    flex: 1, textAlign: 'center',
    color: Colors.textMuted, fontSize: 11, fontWeight: '600',
    paddingVertical: 6,
  },
  calCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  calDay: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  calDaySelected: { backgroundColor: Colors.accent },
  calDayText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '500' },
  calDayToday: { color: Colors.accent, fontWeight: '800' },
  calDayTextSelected: { color: Colors.bgDeep, fontWeight: '800' },
  calDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: Colors.accent, marginTop: 2,
  },
  calDotSpacer: { width: 5, height: 5, marginTop: 2 },

  // Summary
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 10,
    marginBottom: 18,
  },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryValue: { color: Colors.textWhite, fontSize: 15, fontWeight: '700', marginTop: 5 },
  summaryLabel: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  summaryDivider: { width: 1, height: 36, backgroundColor: Colors.divider },

  // Timeline
  timeline: { marginTop: 2 },
  segRow: { flexDirection: 'row', alignItems: 'stretch' },
  rail: { width: NODE, alignItems: 'center' },
  railLine: { flex: 1, width: 2, backgroundColor: Colors.borderStrong, minHeight: 10 },
  railLineHidden: { backgroundColor: 'transparent' },
  railLineDashed: {
    flex: 1, width: 2, minHeight: 8,
    borderLeftWidth: 2, borderColor: Colors.borderStrong,
    borderStyle: 'dashed',
  },
  stayNode: {
    width: NODE, height: NODE, borderRadius: NODE / 2,
    backgroundColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  tripNode: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.bgCardLight,
    borderWidth: 1, borderColor: Colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },

  stayCard: {
    flex: 1,
    marginLeft: 12,
    marginVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  stayTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  staySub: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 4 },

  tripBody: { flex: 1, marginLeft: 12, justifyContent: 'center', paddingVertical: 8 },
  tripText: { color: Colors.textMuted, fontSize: 13, fontWeight: '500' },

  // States
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  mutedText: { color: Colors.textMuted, fontSize: 14, marginTop: 12, textAlign: 'center' },
  retryBtn: {
    marginTop: 16, paddingHorizontal: 22, paddingVertical: 10,
    borderRadius: 24, backgroundColor: Colors.bgGlassStrong,
    borderWidth: 1, borderColor: Colors.borderStrong,
  },
  retryText: { color: Colors.accent, fontWeight: '700' },
})
