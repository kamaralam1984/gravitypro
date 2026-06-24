import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
  FlatList,
  Alert,
  Platform,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useAuthStore } from '../store/authStore'
import { MemberAvatar } from '../components/MemberAvatar'
import ChildParentalSetup from '../components/ChildParentalSetup'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { userAPI, circleAPI, sosAPI, geofenceAPI } from '../services/api'
import { useTheme } from '../theme/ThemeContext'
import { getCurrentLocation } from '../services/location'
import FamilyMap, { haversineMeters, formatDistance } from '../components/FamilyMap'

// ── Greeting helper ───────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ── Shimmer placeholder ───────────────────────────────────────────────────────

function Shimmer({ style }) {
  const c = useTheme()
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.65] })
  return <Animated.View style={[{ backgroundColor: c.bgCardLight, borderRadius: 12 }, style, { opacity }]} />
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, loading, onPress }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const Wrap = onPress ? Pressable : View
  return (
    <Wrap style={styles.statCard} onPress={onPress}>
      <LinearGradient colors={c.gradients.card} style={styles.statGrad}>
        <Text style={styles.statIcon}>{icon}</Text>
        {loading ? (
          <Shimmer style={{ width: 44, height: 22, marginVertical: 4 }} />
        ) : (
          <Text style={styles.statValue}>{value ?? '—'}</Text>
        )}
        <Text style={styles.statLabel}>{label}</Text>
      </LinearGradient>
    </Wrap>
  )
}

// ── Member Chip ───────────────────────────────────────────────────────────────

function MemberChip({ member, memberLocations }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const loc = memberLocations[member.id]
  const isOnline = loc
    ? (!loc.timestamp || Date.now() - new Date(loc.timestamp).getTime() < 5 * 60 * 1000)
    : false

  return (
    <View style={styles.memberChip}>
      <MemberAvatar member={member} size={52} showStatus isOnline={isOnline} />
      <Text style={styles.memberChipName} numberOfLines={1}>
        {member.name?.split(' ')[0] || '?'}
      </Text>
      {loc?.battery != null && (
        <BatteryIndicator level={loc.battery} showText size="sm" />
      )}
    </View>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const c          = useTheme()
  const styles     = useMemo(() => makeStyles(c), [c])
  const user       = useAuthStore(s => s.user)
  const insets     = useSafeAreaInsets()
  const navigation = useNavigation()

  const [loading, setLoading]               = useState(true)
  const [statsLoading, setStatsLoading]     = useState(true)
  const [activeCircle, setActiveCircle]     = useState(null)
  const [members, setMembers]               = useState([])
  const [memberLocations, setMemberLocations] = useState({})
  const [zones, setZones]                   = useState([])
  const [stats, setStats]                   = useState(null)
  const [myLocation, setMyLocation]         = useState(null)
  const [sosSending, setSosSending]         = useState(false)
  const [sosActive, setSosActive]           = useState(false)
  const [safeSending, setSafeSending]       = useState(false)
  const [now, setNow]                       = useState(new Date())

  const fadeAnim = useRef(new Animated.Value(0)).current
  const mapRef   = useRef(null)

  // Tick the clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // ── Mount ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadAll()
    initLocation()
  }, [])

  const loadAll = async () => {
    try {
      await Promise.all([loadCircle(), loadStats()])
    } finally {
      setLoading(false)
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start()
    }
  }

  const loadCircle = async () => {
    try {
      const res = await circleAPI.getAll()
      const circles = res.circles || []
      if (!circles.length) return
      const circle = circles[0]
      setActiveCircle(circle)
      await Promise.all([loadMembers(circle.id), loadZones(circle.id)])
    } catch (e) {
      console.error('Load circle error', e)
    }
  }

  const loadZones = async (circleId) => {
    try {
      const res = await geofenceAPI.getByCircle(circleId)
      setZones(res.safe_zones || [])
    } catch (e) {
      console.error('Load zones error', e)
    }
  }

  const loadMembers = async (circleId) => {
    try {
      const res = await circleAPI.getMembers(circleId)
      const mems = res.members || []
      setMembers(mems)
      const locs = {}
      for (const m of mems) {
        if (m.latitude && m.longitude) {
          locs[m.id] = {
            latitude: m.latitude,
            longitude: m.longitude,
            battery: m.battery_level,
            timestamp: m.location_updated_at || m.updated_at,
          }
        }
      }
      setMemberLocations(locs)
    } catch (e) {
      console.error('Load members error', e)
    }
  }

  const loadStats = async () => {
    setStatsLoading(true)
    try {
      const res = await userAPI.getStats()
      setStats(res.today || res)
    } catch (e) {
      console.error('Load stats error', e)
    } finally {
      setStatsLoading(false)
    }
  }

  const initLocation = async () => {
    try {
      const { getCurrentLocation: getLocation } = await import('../services/location')
      const loc = await getLocation()
      setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
    } catch (e) {
      console.error('Location init error', e)
    }
  }

  // ── SOS ────────────────────────────────────────────────────────────────────

  const handleSOS = () => {
    Alert.alert(
      '🚨 Send SOS Alert',
      'This will immediately notify all family members of your emergency.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: sendSOS,
        },
      ]
    )
  }

  const sendSOS = async () => {
    setSosSending(true)
    try {
      const payload = {}
      if (myLocation) {
        payload.latitude  = myLocation.latitude
        payload.longitude = myLocation.longitude
      }
      await sosAPI.trigger(payload)
      setSosActive(true)
      Alert.alert('SOS Sent', 'Your family has been notified. Help is on the way.')
    } catch (e) {
      Alert.alert('Failed', 'Could not send SOS. Please try again.')
      console.error('SOS trigger error', e)
    } finally {
      setSosSending(false)
    }
  }

  const handleMarkSafe = async () => {
    setSafeSending(true)
    try {
      await sosAPI.markSafe({})
      setSosActive(false)
      Alert.alert("You're marked safe", 'Your family has been notified that you are okay.')
    } catch (e) {
      Alert.alert('Failed', 'Could not mark you as safe. Please try again.')
      console.error('Mark safe error', e)
    } finally {
      setSafeSending(false)
    }
  }

  // ── Members shown on map (with a known location) ─────────────────────────────

  const locatedMembers = members.filter(m => memberLocations[m.id])

  // ── Parent location (parent member, or fall back to my own location) ─────────

  const parentMember = members.find(m => m.account_type === 'parent')
  const parentLoc =
    parentMember && parentMember.latitude != null && parentMember.longitude != null
      ? { latitude: Number(parentMember.latitude), longitude: Number(parentMember.longitude) }
      : myLocation
        ? { latitude: Number(myLocation.latitude), longitude: Number(myLocation.longitude) }
        : null
  const parentName = parentMember?.name?.split(' ')[0] || (user?.id === parentMember?.id ? 'you' : 'you')

  // ── Family distances (each member: nearest zone + distance to parent) ─────────

  const memberDistances = members
    .filter(m => m.id !== user?.id && memberLocations[m.id])
    .map(m => {
      const loc = memberLocations[m.id]
      const cLat = Number(loc.latitude)
      const cLng = Number(loc.longitude)

      // nearest zone
      let nearest = null, nd = Infinity
      for (const z of zones) {
        const d = haversineMeters(cLat, cLng, Number(z.center_lat), Number(z.center_lng))
        if (d < nd) { nd = d; nearest = z }
      }
      const hasZone = !!nearest && Number.isFinite(nd)

      // distance to parent
      const parentDist = parentLoc
        ? haversineMeters(cLat, cLng, parentLoc.latitude, parentLoc.longitude)
        : null

      return {
        id: m.id,
        name: m.name?.split(' ')[0] || '?',
        hasZone,
        dist: nd,
        zone: nearest?.name,
        inside: hasZone && nd <= Number(nearest.radius_meters),
        parentDist,
      }
    })
    .sort((a, b) => {
      const ad = a.hasZone ? a.dist : Infinity
      const bd = b.hasZone ? b.dist : Infinity
      return ad - bd
    })

  // ── Render ─────────────────────────────────────────────────────────────────

  const firstName = user?.name?.split(' ')[0] || 'there'

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>

        {/* ── Hero Header ── */}
        <LinearGradient
          colors={['#042918', '#0A5C35', '#020C05']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroHeader, { paddingTop: insets.top + 20 }]}>

          {/* Greeting */}
          <View style={styles.greetingRow}>
            <View style={styles.greetingLeft}>
              <Text style={styles.greetingText}>{getGreeting()}, {firstName} 👋</Text>
              <Text style={styles.dateText}>{formatTime(now)} · {formatDate(now)}</Text>
            </View>
            {activeCircle && (
              <View style={styles.circleChip}>
                <Ionicons name="people" size={13} color={c.accent} />
                <Text style={styles.circleChipText} numberOfLines={1}>{activeCircle.name}</Text>
              </View>
            )}
          </View>
        </LinearGradient>

        {/* ── Child-device parental controls setup (renders only when needed) ── */}
        <ChildParentalSetup />

        {/* ── Today's Activity ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Activity</Text>
          <View style={styles.statsRow}>
            <StatCard
              icon="🚶"
              label="Distance"
              value={stats?.distance != null ? `${stats.distance} km` : '—'}
              loading={statsLoading}
            />
            <StatCard
              icon="🛡️"
              label="Safe Zones"
              value={stats?.safeZones != null ? String(stats.safeZones) : '—'}
              loading={statsLoading}
              onPress={() => navigation.navigate('SafeZones')}
            />
            <StatCard
              icon="👥"
              label="Check-ins"
              value={stats?.checkins != null ? String(stats.checkins) : '—'}
              loading={statsLoading}
            />
          </View>
        </View>

        {/* ── Family Map (Leaflet/OSM — same map system as the Dashboard) ── */}
        <View style={styles.section}>
          <View style={styles.mapHeaderRow}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Family Map</Text>
            <Pressable onPress={() => navigation.navigate('Map')} hitSlop={8} style={styles.viewFullBtn}>
              <Text style={styles.mapOverlayText}>View Full</Text>
              <Ionicons name="arrow-forward" size={13} color={c.accent} />
            </Pressable>
          </View>

          {loading ? (
            <Shimmer style={styles.mapShimmer} />
          ) : (
            <FamilyMap
              members={locatedMembers}
              zones={zones}
              me={myLocation}
              height={240}
            />
          )}

          {/* Family distances: nearest zone + distance from parent */}
          {!loading && memberDistances.length > 0 && (
            <View style={styles.distCard}>
              <Text style={styles.distTitle}>Family Distances</Text>
              {memberDistances.map(d => (
                <View key={d.id} style={styles.distRow}>
                  <View style={[styles.distDot, { backgroundColor: d.inside ? c.accent : '#FFB300' }]} />
                  <View style={styles.distInfo}>
                    <Text style={styles.distName} numberOfLines={1}>{d.name}</Text>

                    {/* Zone distance line */}
                    <Text style={[styles.distZoneVal, { color: d.inside ? c.accent : '#FFB300' }]}>
                      {d.hasZone
                        ? (d.inside ? `Inside ${d.zone}` : `${formatDistance(d.dist)} · ${d.zone}`)
                        : 'No safe zone'}
                    </Text>

                    {/* Parent distance line */}
                    <Text style={styles.distParentVal}>
                      {d.parentDist != null
                        ? `${formatDistance(d.parentDist)} from ${parentName}`
                        : 'Parent location unknown'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── Family Status ── */}
        {members.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Family Status</Text>
            {loading ? (
              <View style={styles.shimmerRow}>
                {[0, 1, 2].map(i => <Shimmer key={i} style={styles.memberChipShimmer} />)}
              </View>
            ) : (
              <FlatList
                horizontal
                data={members}
                keyExtractor={m => String(m.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.memberList}
                renderItem={({ item }) => (
                  <MemberChip member={item} memberLocations={memberLocations} />
                )}
              />
            )}
          </View>
        )}

        {/* ── Quick SOS ── */}
        <View style={styles.section}>
          <Pressable
            onPress={handleSOS}
            disabled={sosSending}
            style={({ pressed }) => [styles.sosBtn, pressed && { opacity: 0.85 }]}>
            <LinearGradient
              colors={['#E53935', '#B71C1C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.sosBtnGrad}>
              {sosSending ? (
                <>
                  <View style={styles.sosBtnIconWrap}>
                    <Ionicons name="time-outline" size={24} color="#fff" />
                  </View>
                  <Text style={styles.sosBtnText}>Sending SOS…</Text>
                </>
              ) : (
                <>
                  <View style={styles.sosBtnIconWrap}>
                    <Ionicons name="warning" size={24} color="#fff" />
                  </View>
                  <Text style={styles.sosBtnText}>🚨 Send SOS</Text>
                  <Text style={styles.sosBtnSub}>Alerts all family members</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          {sosActive && (
            <Pressable
              onPress={handleMarkSafe}
              disabled={safeSending}
              style={({ pressed }) => [styles.safeBtn, pressed && { opacity: 0.85 }]}>
              <LinearGradient
                colors={['#00C853', '#0A5C35']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.safeBtnGrad}>
                <View style={styles.safeBtnIconWrap}>
                  <Ionicons name={safeSending ? 'time-outline' : 'checkmark-circle'} size={22} color="#fff" />
                </View>
                <Text style={styles.safeBtnText}>{safeSending ? 'Marking…' : "I'm Safe"}</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>

      </Animated.ScrollView>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c) => StyleSheet.create({
  container:     { flex: 1, backgroundColor: c.bgDeep },
  scrollContent: { flexGrow: 1 },

  // Hero Header
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  greetingLeft:  { flex: 1 },
  greetingText:  { fontSize: 22, fontWeight: '800', color: c.textWhite, flexShrink: 1 },
  dateText:      { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: c.border,
    flexShrink: 0,
    maxWidth: 130,
  },
  circleChipText: { color: c.textSecondary, fontSize: 12, fontWeight: '600', flexShrink: 1 },

  // Sections
  section:      { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textSecondary, marginBottom: 12 },

  // Stat Cards
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
  statGrad: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 8, gap: 4 },
  statIcon:  { fontSize: 22 },
  statValue: { fontSize: 18, fontWeight: '800', color: c.textWhite },
  statLabel: { fontSize: 11, fontWeight: '600', color: c.textMuted, textAlign: 'center' },

  // Mini Map
  mapContainer: {
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.border,
    position: 'relative',
  },
  miniMap:      { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapPreviewText: { color: 'rgba(0,230,118,0.6)', fontSize: 13, fontWeight: '600' },
  mapShimmer:   { flex: 1, borderRadius: 20 },
  mapOverlayBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  mapOverlayGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  mapOverlayText: { color: c.accent, fontSize: 12, fontWeight: '700' },

  // Map header + distances
  mapHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  viewFullBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distCard: {
    marginTop: 12,
    backgroundColor: c.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  distTitle: { color: c.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  distRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  distDot:   { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  distInfo:  { flex: 1, gap: 2 },
  distName:  { color: c.textWhite, fontSize: 14, fontWeight: '600' },
  distVal:   { fontSize: 13, fontWeight: '700' },
  distZoneVal:   { fontSize: 13, fontWeight: '700' },
  distParentVal: { fontSize: 12, fontWeight: '600', color: c.textMuted },

  // Map markers
  myDot:        { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  myDotInner:   { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  memberDot:    { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  memberDotInner: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.info, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  memberDotInitial: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Family Status
  memberList:        { paddingRight: 4, gap: 12 },
  memberChip:        { alignItems: 'center', gap: 6, width: 72 },
  memberChipName:    { color: c.textSecondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  shimmerRow:        { flexDirection: 'row', gap: 12 },
  memberChipShimmer: { width: 72, height: 90, borderRadius: 16 },

  // SOS Button
  sosBtn:     { borderRadius: 20, overflow: 'hidden', shadowColor: '#E53935', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 14, elevation: 14 },
  sosBtnGrad: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20, gap: 14 },
  sosBtnIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosBtnText: { fontSize: 20, fontWeight: '800', color: '#fff', flex: 1 },
  sosBtnSub:  { fontSize: 12, color: 'rgba(255,255,255,0.75)', position: 'absolute', bottom: 12, right: 24 },
  safeBtn:     { borderRadius: 20, overflow: 'hidden', marginTop: 12, shadowColor: '#00C853', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 12 },
  safeBtnGrad: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 18, gap: 14 },
  safeBtnIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  safeBtnText: { fontSize: 18, fontWeight: '800', color: '#fff' },
})
