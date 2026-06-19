import React, { useEffect, useState, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, Animated, Pressable, Image, Platform } from 'react-native'
const NativeEventSource = Platform.OS !== 'web' ? require('react-native-sse').default : null
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuthStore } from '../store/authStore'
import { MemberAvatar } from '../components/MemberAvatar'
import { PulseRing } from '../components/PulseRing'
import { circleAPI, geofenceAPI } from '../services/api'
import { startBackgroundTracking, getCurrentLocation } from '../services/location'
import { Colors } from '../theme/colors'
import { DARK_MAP_STYLE } from '../theme/mapStyles'

export default function HomeScreen() {
  const user = useAuthStore(s => s.user)
  const insets = useSafeAreaInsets()
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [members, setMembers] = useState([])
  const [myLocation, setMyLocation] = useState(null)
  const [memberLocations, setMemberLocations] = useState({})
  const [safeZones, setSafeZones] = useState([])
  const [flashingZones, setFlashingZones] = useState({})
  const mapRef = useRef(null)
  const headerOpacity = useRef(new Animated.Value(0)).current
  const sseRef = useRef(null)

  useEffect(() => {
    Animated.timing(headerOpacity, { toValue: 1, duration: 600, useNativeDriver: true }).start()
    loadCircles()
    initLocation()
    return () => sseRef.current?.close()
  }, [])

  const loadCircles = async () => {
    try {
      const res = await circleAPI.getAll()
      setCircles(res.circles || [])
      if (res.circles?.length) setActiveCircle(res.circles[0])
    } catch (e) { console.error('Load circles error', e) }
  }

  const initLocation = async () => {
    try {
      const loc = await getCurrentLocation()
      setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      await startBackgroundTracking()
    } catch (e) { console.error('Location init error', e) }
  }

  useEffect(() => {
    if (!activeCircle) return
    loadMembers(activeCircle.id)
    loadSafeZones(activeCircle.id)
    connectSSE()
  }, [activeCircle, connectSSE])

  const loadMembers = async (circleId) => {
    try {
      const res = await circleAPI.getMembers(circleId)
      setMembers(res.members || [])
      const locs = {}
      for (const m of res.members) {
        if (m.latitude && m.longitude) {
          locs[m.id] = { latitude: m.latitude, longitude: m.longitude, battery: m.battery_level }
        }
      }
      setMemberLocations(locs)
    } catch (e) { console.error('Load members error', e) }
  }

  const loadSafeZones = async (circleId) => {
    try {
      const res = await geofenceAPI.getByCircle(circleId)
      setSafeZones(res.safe_zones || [])
    } catch (e) { console.error('Load safe zones error', e) }
  }

  const flashZone = (zoneId) => {
    setFlashingZones(prev => ({ ...prev, [zoneId]: true }))
    setTimeout(() => {
      setFlashingZones(prev => { const n = { ...prev }; delete n[zoneId]; return n })
    }, 3000)
  }

  const connectSSE = useCallback(async () => {
    if (Platform.OS === 'web') return
    const { storage } = await import('../utils/storage')
    const token = await storage.getItem('auth_token')
    if (!token) return
    sseRef.current?.close()
    const SSE_URL = __DEV__
      ? 'http://192.168.0.197:3021/api/v1/sse/stream'
      : 'https://gravity.trackalways.com/api/v1/sse/stream'
    const es = new NativeEventSource(SSE_URL, {
      headers: { Authorization: 'Bearer ' + token }
    })
    es.addEventListener('location_update', (e) => {
      const data = JSON.parse(e.data)
      setMemberLocations(prev => ({
        ...prev,
        [data.userId]: {
          latitude: data.latitude,
          longitude: data.longitude,
          battery: data.battery_level,
          timestamp: data.timestamp
        }
      }))
    })
    es.addEventListener('geofence_event', (e) => {
      const data = JSON.parse(e.data)
      if (data.zone_id) {
        setFlashingZones(prev => ({ ...prev, [data.zone_id]: true }))
        setTimeout(() => {
          setFlashingZones(prev => { const n = { ...prev }; delete n[data.zone_id]; return n })
        }, 3000)
      }
    })
    sseRef.current = es
  }, [])

  const centerOnMe = () => {
    if (!myLocation || !mapRef.current) return
    mapRef.current.animateToRegion({ ...myLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800)
  }

  const isOnline = (memberId) => {
    const loc = memberLocations[memberId]
    if (!loc?.timestamp) return !!loc
    return Date.now() - new Date(loc.timestamp).getTime() < 5 * 60 * 1000
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        initialRegion={
          myLocation
            ? { ...myLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 }
            : { latitude: 1.2921, longitude: 36.8219, latitudeDelta: 60, longitudeDelta: 60 }
        }>

        {/* Safe Zone overlays */}
        {safeZones.map(zone => (
          <React.Fragment key={zone.id}>
            <Circle
              center={{ latitude: zone.center_lat, longitude: zone.center_lng }}
              radius={zone.radius_meters}
              fillColor={flashingZones[zone.id] ? 'rgba(0,230,118,0.35)' : 'rgba(0,200,83,0.1)'}
              strokeColor={flashingZones[zone.id] ? Colors.accent : Colors.accentSoft}
              strokeWidth={flashingZones[zone.id] ? 3 : 1.5}
            />
            <Marker
              coordinate={{ latitude: zone.center_lat, longitude: zone.center_lng }}
              title={zone.name}
              anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.zoneMarker}>
                <LinearGradient colors={['rgba(10,92,53,0.9)', 'rgba(13,122,69,0.9)']} style={styles.zoneMarkerGrad}>
                  <Ionicons name="shield-checkmark" size={12} color={Colors.accent} />
                </LinearGradient>
              </View>
            </Marker>
          </React.Fragment>
        ))}

        {/* My location marker */}
        {myLocation && (
          <Marker coordinate={myLocation} title="You" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.myMarkerWrap}>
              <PulseRing color={Colors.accent} size={50} active />
              <LinearGradient colors={['#00E676', '#00C853']} style={styles.myMarkerGradient}>
                <Ionicons name="person" size={16} color="#fff" />
              </LinearGradient>
            </View>
          </Marker>
        )}

        {/* Other member markers — FIXED: show Image if avatar_url, else show initials */}
        {members
          .filter(m => m.id !== user?.id && memberLocations[m.id])
          .map(member => (
            <Marker
              key={member.id}
              coordinate={memberLocations[member.id]}
              title={member.name}
              anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.memberMarkerWrap}>
                {isOnline(member.id) && (
                  <PulseRing color={Colors.info} size={46} active />
                )}
                <View style={styles.memberMarkerRing}>
                  {member.avatar_url ? (
                    <Image
                      source={{ uri: member.avatar_url }}
                      style={styles.memberMarkerImage}
                    />
                  ) : (
                    <View style={styles.memberMarkerInitialWrap}>
                      <Text style={styles.memberMarkerInitial}>
                        {member.name?.[0]?.toUpperCase() || '?'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Marker>
          ))}
      </MapView>

      {/* Header overlay */}
      <Animated.View style={[styles.header, { paddingTop: insets.top + 8, opacity: headerOpacity }]}>
        <LinearGradient colors={['rgba(5,15,8,0.95)', 'rgba(5,15,8,0)']} style={StyleSheet.absoluteFill} />
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.greeting}>
              {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}
            </Text>
            <Text style={styles.userName}>{user?.name?.split(' ')[0]} 👋</Text>
          </View>
          {activeCircle && (
            <View style={styles.circleChip}>
              <Ionicons name="people" size={14} color={Colors.accent} />
              <Text style={styles.circleChipText}>{activeCircle.name}</Text>
              <View style={styles.memberCountBadge}>
                <Text style={styles.memberCountText}>{members.length}</Text>
              </View>
            </View>
          )}
        </View>
      </Animated.View>

      {/* Member strip at bottom */}
      {members.length > 0 && (
        <View style={[styles.memberStrip, { bottom: insets.bottom + 100 }]}>
          {members.map((m) => (
            <Animated.View key={m.id} style={[styles.memberChip, { opacity: headerOpacity }]}>
              <MemberAvatar member={m} size={40} showStatus isOnline={isOnline(m.id)} />
              <Text style={styles.memberName}>{m.name?.split(' ')[0]}</Text>
            </Animated.View>
          ))}
        </View>
      )}

      {/* FAB */}
      <Pressable style={[styles.fab, { bottom: insets.bottom + 28, right: 20 }]} onPress={centerOnMe}>
        <LinearGradient colors={['#0D7A45', '#0A5C35']} style={styles.fabGradient}>
          <Ionicons name="locate" size={24} color="#fff" />
        </LinearGradient>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 20 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 13, color: Colors.textMuted, fontWeight: '500' },
  userName: { fontSize: 22, color: Colors.textWhite, fontWeight: '800' },
  circleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.bgGlassStrong, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border },
  circleChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  memberCountBadge: { backgroundColor: Colors.primaryLight, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  memberCountText: { color: Colors.accent, fontSize: 12, fontWeight: '800' },
  myMarkerWrap: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  myMarkerGradient: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.8, shadowRadius: 8, elevation: 10 },
  memberMarkerWrap: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56 },
  memberMarkerRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 2.5, borderColor: Colors.info, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgCard },
  memberMarkerImage: { width: 36, height: 36, borderRadius: 18 },
  memberMarkerInitialWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  memberMarkerInitial: { color: Colors.accent, fontSize: 16, fontWeight: '800' },
  zoneMarker: { alignItems: 'center' },
  zoneMarkerGrad: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.accentSoft },
  memberStrip: { position: 'absolute', left: 16, flexDirection: 'row', gap: 10 },
  memberChip: { alignItems: 'center', gap: 4 },
  memberName: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textShadowColor: Colors.bgDeep, textShadowRadius: 4 },
  fab: { position: 'absolute', shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 12 },
  fabGradient: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
})
