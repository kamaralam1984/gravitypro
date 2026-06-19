import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Image,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native'
import MapView, { Marker, Circle as MapCircle, PROVIDER_GOOGLE } from 'react-native-maps'
import * as Location from 'expo-location'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuthStore } from '../store/authStore'
import { MemberAvatar } from '../components/MemberAvatar'
import { PulseRing } from '../components/PulseRing'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { circleAPI } from '../services/api'
import { getCurrentLocation, startBackgroundTracking } from '../services/location'
import { Colors } from '../theme/colors'
import { DARK_MAP_STYLE } from '../theme/mapStyles'
import api from '../services/api'

// ── helpers ──────────────────────────────────────────────────────────────────

const formatLastSeen = (ts) => {
  if (!ts) return 'Unknown'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

const isOnlineMember = (loc) => {
  if (!loc) return false
  if (!loc.timestamp) return true
  return Date.now() - new Date(loc.timestamp).getTime() < 5 * 60 * 1000
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const user = useAuthStore((s) => s.user)
  const insets = useSafeAreaInsets()

  // map state
  const mapRef = useRef(null)
  const [myLocation, setMyLocation] = useState(null)
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [members, setMembers] = useState([])
  const [memberLocations, setMemberLocations] = useState({})
  const [selectedMember, setSelectedMember] = useState(null)

  // loading / error
  const [refreshing, setRefreshing] = useState(false)

  // intervals
  const pollRef = useRef(null)
  const locationSyncRef = useRef(null)

  // animations
  const headerAnim = useRef(new Animated.Value(0)).current
  const cardAnim = useRef(new Animated.Value(200)).current   // slide-up card
  const cardOpacity = useRef(new Animated.Value(0)).current
  const sosPulse = useRef(new Animated.Value(1)).current

  // ── animation setup ───────────────────────────────────────────────────────

  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start()

    // SOS pulsing loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(sosPulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(sosPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start()
  }, [])

  // ── card show / hide ──────────────────────────────────────────────────────

  const showCard = useCallback(() => {
    Animated.parallel([
      Animated.spring(cardAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start()
  }, [cardAnim, cardOpacity])

  const hideCard = useCallback(() => {
    Animated.parallel([
      Animated.timing(cardAnim, { toValue: 200, duration: 250, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setSelectedMember(null))
  }, [cardAnim, cardOpacity])

  // ── location ──────────────────────────────────────────────────────────────

  const initLocation = async () => {
    try {
      const loc = await getCurrentLocation()
      const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      setMyLocation(coord)
      await startBackgroundTracking()
    } catch (e) {
      console.error('[MapScreen] location init:', e)
    }
  }

  const syncLocationToServer = useCallback(async () => {
    if (!myLocation) return
    try {
      const loc = await getCurrentLocation()
      const { latitude, longitude } = loc.coords
      setMyLocation({ latitude, longitude })
      // POST location to backend (same endpoint background task uses via Traccar,
      // but also update via our API so SSE can broadcast to circle members)
      await api.post('/locations', {
        latitude,
        longitude,
        accuracy: loc.coords.accuracy,
        battery_level: null, // expo-battery not imported here; omit gracefully
      }).catch(() => {})
    } catch (e) {
      console.error('[MapScreen] syncLocation:', e)
    }
  }, [myLocation])

  // ── circles & members ─────────────────────────────────────────────────────

  const loadCircles = async () => {
    try {
      const res = await circleAPI.getAll()
      const list = res.circles || []
      setCircles(list)
      if (list.length && !activeCircle) setActiveCircle(list[0])
    } catch (e) {
      console.error('[MapScreen] loadCircles:', e)
    }
  }

  const loadMembers = useCallback(async (circleId) => {
    if (!circleId) return
    try {
      const res = await circleAPI.getMembers(circleId)
      const list = res.members || []
      setMembers(list)
      const locs = {}
      for (const m of list) {
        if (m.latitude && m.longitude) {
          locs[m.id] = {
            latitude: m.latitude,
            longitude: m.longitude,
            battery: m.battery_level,
            timestamp: m.last_seen || m.updated_at,
          }
        }
      }
      setMemberLocations(locs)
    } catch (e) {
      console.error('[MapScreen] loadMembers:', e)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await loadCircles()
    if (activeCircle) await loadMembers(activeCircle.id)
    setRefreshing(false)
  }, [activeCircle, loadMembers])

  // ── SOS ───────────────────────────────────────────────────────────────────

  const handleSOS = async () => {
    Alert.alert(
      'Send SOS Alert',
      'This will alert all family members with your current location.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'SEND SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post('/sos', {
                latitude: myLocation?.latitude ?? null,
                longitude: myLocation?.longitude ?? null,
                message: 'SOS! I need help!',
              })
              Alert.alert('SOS Sent', 'Your family has been notified.')
            } catch (e) {
              Alert.alert('Error', 'Could not send SOS. Please try again.')
            }
          },
        },
      ]
    )
  }

  // ── tap member marker ─────────────────────────────────────────────────────

  const handleMemberTap = useCallback(
    (member) => {
      setSelectedMember(member)
      showCard()
      const loc = memberLocations[member.id]
      if (loc && mapRef.current) {
        mapRef.current.animateToRegion(
          { ...loc, latitudeDelta: 0.01, longitudeDelta: 0.01 },
          600
        )
      }
    },
    [memberLocations, showCard]
  )

  // ── center on self ────────────────────────────────────────────────────────

  const centerOnMe = () => {
    if (!myLocation || !mapRef.current) return
    mapRef.current.animateToRegion(
      { ...myLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      800
    )
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    initLocation()
    loadCircles()
    return () => {
      clearInterval(pollRef.current)
      clearInterval(locationSyncRef.current)
    }
  }, [])

  useEffect(() => {
    if (!activeCircle) return
    loadMembers(activeCircle.id)

    clearInterval(pollRef.current)
    pollRef.current = setInterval(() => loadMembers(activeCircle.id), 10000)

    return () => clearInterval(pollRef.current)
  }, [activeCircle, loadMembers])

  useEffect(() => {
    clearInterval(locationSyncRef.current)
    locationSyncRef.current = setInterval(syncLocationToServer, 30000)
    return () => clearInterval(locationSyncRef.current)
  }, [syncLocationToServer])

  // ── derived ───────────────────────────────────────────────────────────────

  const onlineCount = members.filter((m) => isOnlineMember(memberLocations[m.id])).length
  const selectedLoc = selectedMember ? memberLocations[selectedMember.id] : null

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Full-screen map ── */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        onPress={() => selectedMember && hideCard()}
        initialRegion={
          myLocation
            ? { ...myLocation, latitudeDelta: 0.04, longitudeDelta: 0.04 }
            : { latitude: 1.2921, longitude: 36.8219, latitudeDelta: 60, longitudeDelta: 60 }
        }>

        {/* Own location — pulsing green dot */}
        {myLocation && (
          <Marker coordinate={myLocation} title="You" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.myMarkerWrap}>
              <PulseRing color={Colors.accent} size={52} active />
              <LinearGradient
                colors={['#00E676', '#00C853']}
                style={styles.myMarkerGrad}>
                <Ionicons name="person" size={16} color="#fff" />
              </LinearGradient>
            </View>
          </Marker>
        )}

        {/* Family member markers */}
        {members
          .filter((m) => m.id !== user?.id && memberLocations[m.id])
          .map((member) => {
            const loc = memberLocations[member.id]
            const online = isOnlineMember(loc)
            const isSelected = selectedMember?.id === member.id
            return (
              <Marker
                key={member.id}
                coordinate={loc}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => handleMemberTap(member)}>
                <View style={styles.memberMarkerWrap}>
                  {online && (
                    <PulseRing
                      color={isSelected ? Colors.accent : Colors.info}
                      size={48}
                      active
                    />
                  )}
                  <View
                    style={[
                      styles.memberRing,
                      isSelected && styles.memberRingSelected,
                    ]}>
                    {member.avatar_url ? (
                      <Image
                        source={{ uri: member.avatar_url }}
                        style={styles.memberImage}
                      />
                    ) : (
                      <View style={styles.memberInitialWrap}>
                        <Text style={styles.memberInitial}>
                          {member.name?.[0]?.toUpperCase() || '?'}
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* Accuracy circle hint */}
                  {isSelected && (
                    <View style={styles.selectedPip} />
                  )}
                </View>
              </Marker>
            )
          })}
      </MapView>

      {/* ── Header overlay ── */}
      <Animated.View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, opacity: headerAnim },
        ]}>
        <LinearGradient
          colors={['rgba(5,15,8,0.96)', 'rgba(5,15,8,0)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerLabel}>FAMILY MAP</Text>
            {activeCircle && (
              <Text style={styles.headerCircle}>{activeCircle.name}</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            {/* Member count chip */}
            <View style={styles.countChip}>
              <View style={styles.countDot} />
              <Text style={styles.countText}>
                {onlineCount}/{members.length} online
              </Text>
            </View>
            {/* Refresh button */}
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={refresh}
              activeOpacity={0.7}>
              <Ionicons
                name={refreshing ? 'sync' : 'refresh'}
                size={18}
                color={Colors.accent}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* ── Locate-me FAB (left of SOS) ── */}
      <Pressable
        style={[styles.locateFab, { bottom: insets.bottom + 108, right: 20 }]}
        onPress={centerOnMe}>
        <LinearGradient
          colors={['#0D7A45', '#0A5C35']}
          style={styles.locateFabGrad}>
          <Ionicons name="locate" size={22} color="#fff" />
        </LinearGradient>
      </Pressable>

      {/* ── SOS FAB ── */}
      <Animated.View
        style={[
          styles.sosFabWrap,
          { bottom: insets.bottom + 36, right: 20 },
          { transform: [{ scale: sosPulse }] },
        ]}>
        <Pressable style={styles.sosFab} onPress={handleSOS}>
          <LinearGradient colors={['#FF1744', '#B71C1C']} style={styles.sosFabGrad}>
            <Text style={styles.sosLabel}>SOS</Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {/* ── Member info card (slides up on tap) ── */}
      {selectedMember && (
        <Animated.View
          style={[
            styles.memberCard,
            {
              bottom: insets.bottom + 16,
              opacity: cardOpacity,
              transform: [{ translateY: cardAnim }],
            },
          ]}>
          <LinearGradient
            colors={['#0F2518', '#081510']}
            style={styles.memberCardGrad}>

            {/* Close button */}
            <TouchableOpacity style={styles.cardClose} onPress={hideCard}>
              <Ionicons name="close" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            {/* Avatar + info */}
            <View style={styles.cardTop}>
              <MemberAvatar
                member={selectedMember}
                size={52}
                showStatus
                isOnline={isOnlineMember(selectedLoc)}
              />
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{selectedMember.name}</Text>
                <View style={styles.cardBadgeRow}>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleText}>
                      {(selectedMember.role || 'member').toUpperCase()}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor: isOnlineMember(selectedLoc)
                          ? Colors.online
                          : Colors.offline,
                      },
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {isOnlineMember(selectedLoc) ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.cardStats}>
              {/* Battery */}
              <View style={styles.cardStat}>
                <Ionicons name="battery-half" size={16} color={Colors.textMuted} />
                <Text style={styles.cardStatLabel}>Battery</Text>
                <BatteryIndicator
                  level={selectedLoc?.battery ?? null}
                  showText
                  size="sm"
                />
                {selectedLoc?.battery == null && (
                  <Text style={styles.cardStatValue}>—</Text>
                )}
              </View>

              <View style={styles.cardDivider} />

              {/* Last seen */}
              <View style={styles.cardStat}>
                <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.cardStatLabel}>Last seen</Text>
                <Text style={styles.cardStatValue}>
                  {formatLastSeen(selectedLoc?.timestamp)}
                </Text>
              </View>

              <View style={styles.cardDivider} />

              {/* Location available */}
              <View style={styles.cardStat}>
                <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.cardStatLabel}>Location</Text>
                <Text style={styles.cardStatValue}>
                  {selectedLoc ? 'Shared' : 'Hidden'}
                </Text>
              </View>
            </View>

            {/* Navigate hint */}
            {selectedLoc && (
              <TouchableOpacity
                style={styles.viewOnMapBtn}
                onPress={() => {
                  if (mapRef.current && selectedLoc) {
                    mapRef.current.animateToRegion(
                      { ...selectedLoc, latitudeDelta: 0.005, longitudeDelta: 0.005 },
                      700
                    )
                  }
                }}>
                <Ionicons name="navigate" size={15} color={Colors.accent} />
                <Text style={styles.viewOnMapText}>Zoom to location</Text>
              </TouchableOpacity>
            )}
          </LinearGradient>
        </Animated.View>
      )}
    </View>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },

  // ── header ──
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: Colors.textMuted,
  },
  headerCircle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textWhite,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  countDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.online,
  },
  countText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgGlassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // ── my marker ──
  myMarkerWrap: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  myMarkerGrad: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 10,
  },

  // ── member markers ──
  memberMarkerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
  },
  memberRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2.5,
    borderColor: Colors.info,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgCard,
  },
  memberRingSelected: {
    borderColor: Colors.accent,
    borderWidth: 3,
  },
  memberImage: { width: 36, height: 36, borderRadius: 18 },
  memberInitialWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { color: Colors.accent, fontSize: 16, fontWeight: '800' },
  selectedPip: {
    position: 'absolute',
    bottom: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    borderWidth: 1.5,
    borderColor: Colors.bgDeep,
  },

  // ── locate FAB ──
  locateFab: {
    position: 'absolute',
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
  locateFabGrad: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── SOS FAB ──
  sosFabWrap: {
    position: 'absolute',
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 14,
  },
  sosFab: { borderRadius: 32 },
  sosFabGrad: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,23,68,0.4)',
  },
  sosLabel: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },

  // ── member card ──
  memberCard: {
    position: 'absolute',
    left: 16,
    right: 84, // avoid SOS button
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    shadowColor: Colors.shadowDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 20,
  },
  memberCardGrad: { padding: 18 },
  cardClose: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bgGlassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  cardInfo: { flex: 1 },
  cardName: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textWhite,
    marginBottom: 6,
  },
  cardBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: {
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  roleText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },

  // stats row
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgGlass,
    borderRadius: 12,
    padding: 12,
    gap: 0,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  cardStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  cardStatLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  cardStatValue: { fontSize: 13, color: Colors.textSecondary, fontWeight: '700' },
  cardDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.divider,
  },

  // zoom button
  viewOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.bgGlassStrong,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  viewOnMapText: { fontSize: 13, fontWeight: '700', color: Colors.accent },
})
