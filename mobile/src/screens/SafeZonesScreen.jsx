import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, Pressable, Animated, ScrollView,
  TextInput, Modal, Dimensions, ActivityIndicator, Alert, Platform,
} from 'react-native'
import MapView, { Circle as MapCircle, Marker, PROVIDER_GOOGLE } from 'react-native-maps'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import Slider from '@react-native-community/slider'
import { circleAPI, geofenceAPI } from '../services/api'
import { GradientCard } from '../components/ui/GradientCard'
import { PremiumButton } from '../components/ui/PremiumButton'
import { Colors, Gradients } from '../theme/colors'
import { DARK_MAP_STYLE } from '../theme/mapStyles'

const { width, height } = Dimensions.get('window')
const MAP_HEIGHT = height * 0.45

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatRadius = (r) => r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`

const formatCoord = (n) => (Math.round(n * 10000) / 10000).toFixed(4)

// ─── Zone Card ────────────────────────────────────────────────────────────────

function ZoneCard({ zone, index, onDelete, onFocus }) {
  const slideAnim = useRef(new Animated.Value(40)).current
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, index * 70)
  }, [])

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 12 }}>
      <GradientCard style={styles.zoneCard}>
        <Pressable onPress={() => onFocus(zone)} style={styles.zoneCardMain}>
          <LinearGradient
            colors={['rgba(0,200,83,0.22)', 'rgba(0,200,83,0.07)']}
            style={styles.zoneIconWrap}>
            <Ionicons name="shield-checkmark" size={22} color={Colors.accentSoft} />
          </LinearGradient>

          <View style={styles.zoneTextBlock}>
            <Text style={styles.zoneName}>{zone.name}</Text>
            <Text style={styles.zoneRadius}>{formatRadius(zone.radius_meters)} radius</Text>
            <Text style={styles.zoneCoords}>
              {formatCoord(zone.center_lat)}, {formatCoord(zone.center_lng)}
            </Text>
          </View>
        </Pressable>

        <Pressable onPress={() => onDelete(zone)} style={styles.deleteBtn} hitSlop={6}>
          <Ionicons name="trash-outline" size={18} color={Colors.danger} />
        </Pressable>
      </GradientCard>
    </Animated.View>
  )
}

// ─── Circle Chip ─────────────────────────────────────────────────────────────

function CircleChip({ circle, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      {active && (
        <LinearGradient colors={Gradients.button} style={StyleSheet.absoluteFill} borderRadius={20} />
      )}
      <Ionicons
        name="people"
        size={13}
        color={active ? Colors.accent : Colors.textMuted}
      />
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{circle.name}</Text>
    </Pressable>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SafeZonesScreen() {
  const insets = useSafeAreaInsets()
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [safeZones, setSafeZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [zoneName, setZoneName] = useState('')
  const [radius, setRadius] = useState(200)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [pickingOnMap, setPickingOnMap] = useState(false)
  const mapRef = useRef(null)
  const modalMapRef = useRef(null)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const headerAnim = useRef(new Animated.Value(0)).current
  const modalAnim = useRef(new Animated.Value(350)).current

  useEffect(() => {
    loadData()
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await circleAPI.getMy()
      const circs = res.circles || []
      setCircles(circs)
      if (circs.length) {
        setActiveCircle(circs[0])
        await loadZones(circs[0].id)
      }
    } catch (e) {
      console.error('Load data error', e)
    } finally {
      setLoading(false)
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start()
    }
  }

  const loadZones = async (circleId) => {
    try {
      const res = await geofenceAPI.getByCircle(circleId)
      setSafeZones(res.safe_zones || [])
    } catch (e) {
      console.error('Load zones error', e)
    }
  }

  const switchCircle = async (circle) => {
    if (circle.id === activeCircle?.id) return
    if (Platform.OS !== 'web') Haptics.selectionAsync()
    setActiveCircle(circle)
    setSafeZones([])
    await loadZones(circle.id)
  }

  const focusZoneOnMap = useCallback((zone) => {
    if (!mapRef.current) return
    mapRef.current.animateToRegion({
      latitude: zone.center_lat,
      longitude: zone.center_lng,
      latitudeDelta: (zone.radius_meters / 111000) * 4,
      longitudeDelta: (zone.radius_meters / 111000) * 4,
    }, 600)
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  const openCreateModal = () => {
    setShowCreateModal(true)
    setSelectedLocation(null)
    setZoneName('')
    setRadius(200)
    setError('')
    setPickingOnMap(false)
    Animated.spring(modalAnim, { toValue: 0, tension: 65, friction: 10, useNativeDriver: true }).start()
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const closeCreateModal = () => {
    Animated.timing(modalAnim, { toValue: 350, duration: 250, useNativeDriver: true }).start(() => {
      setShowCreateModal(false)
    })
  }

  const handleMainMapPress = (e) => {
    // Main map just browses; tapping individual cards focuses them
  }

  const handleModalMapPress = (e) => {
    setSelectedLocation(e.nativeEvent.coordinate)
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPickingOnMap(false)
  }

  const handleCreateZone = async () => {
    if (!activeCircle) { setError('No circle selected'); return }
    if (!selectedLocation) { setError('Tap on the map above to pick a location'); return }
    if (!zoneName.trim()) { setError('Zone name is required'); return }
    setCreating(true)
    setError('')
    try {
      await geofenceAPI.create({
        circle_id: activeCircle.id,
        name: zoneName.trim(),
        center_lat: selectedLocation.latitude,
        center_lng: selectedLocation.longitude,
        radius_meters: radius,
      })
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      closeCreateModal()
      await loadZones(activeCircle.id)
    } catch (e) {
      setError(e.error || 'Failed to create safe zone')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteZone = (zone) => {
    Alert.alert(
      'Delete Safe Zone',
      `Remove "${zone.name}" from your circle?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await geofenceAPI.remove(zone.id)
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
              await loadZones(activeCircle.id)
            } catch (e) {
              Alert.alert('Error', 'Failed to delete zone. Please try again.')
            }
          },
        },
      ]
    )
  }

  // Compute initial map region from zones or default
  const mapRegion = safeZones.length > 0
    ? {
        latitude: safeZones[0].center_lat,
        longitude: safeZones[0].center_lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : {
        latitude: 37.7749,
        longitude: -122.4194,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <Animated.View style={[styles.header, { paddingTop: insets.top + 10, opacity: headerAnim }]}>
        <LinearGradient
          colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.82)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Safe Zones</Text>
            <Text style={styles.headerSubtitle}>
              {safeZones.length} zone{safeZones.length !== 1 ? 's' : ''} active
              {activeCircle ? ` · ${activeCircle.name}` : ''}
            </Text>
          </View>
          <View style={styles.headerShieldBadge}>
            <Ionicons name="shield-checkmark" size={16} color={Colors.accent} />
            <Text style={styles.headerShieldText}>{safeZones.length}</Text>
          </View>
        </View>

        {/* Circle Switcher */}
        {circles.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            style={styles.chipScroll}>
            {circles.map(c => (
              <CircleChip
                key={c.id}
                circle={c}
                active={activeCircle?.id === c.id}
                onPress={() => switchCircle(c)}
              />
            ))}
          </ScrollView>
        )}
      </Animated.View>

      {/* Map — top 45% */}
      <View style={[styles.mapContainer, { height: MAP_HEIGHT }]}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          customMapStyle={DARK_MAP_STYLE}
          showsUserLocation
          showsCompass={false}
          initialRegion={mapRegion}
          onPress={handleMainMapPress}>
          {safeZones.map(zone => (
            <React.Fragment key={zone.id}>
              <MapCircle
                center={{ latitude: zone.center_lat, longitude: zone.center_lng }}
                radius={zone.radius_meters}
                fillColor="rgba(0,200,83,0.13)"
                strokeColor="#00C853"
                strokeWidth={2}
              />
              <Marker
                coordinate={{ latitude: zone.center_lat, longitude: zone.center_lng }}
                title={zone.name}
                description={`${formatRadius(zone.radius_meters)} radius`}>
                <View style={styles.zoneMarker}>
                  <LinearGradient colors={['#0D7A45', '#0A5C35']} style={styles.zoneMarkerGrad}>
                    <Ionicons name="shield-checkmark" size={14} color={Colors.accent} />
                  </LinearGradient>
                </View>
              </Marker>
            </React.Fragment>
          ))}
        </MapView>

        {/* Gradient fade at bottom of map */}
        <LinearGradient
          colors={['transparent', 'rgba(2,12,5,0.85)']}
          style={styles.mapBottomFade}
          pointerEvents="none"
        />

        {/* Zone count overlay */}
        {safeZones.length > 0 && (
          <View style={styles.mapBadge}>
            <Ionicons name="shield-checkmark" size={12} color={Colors.accent} />
            <Text style={styles.mapBadgeText}>{safeZones.length} zones</Text>
          </View>
        )}

        {/* FAB on map */}
        <Pressable style={styles.fab} onPress={openCreateModal}>
          <LinearGradient colors={Gradients.buttonHero} style={styles.fabGrad}>
            <Ionicons name="add" size={26} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>

      {/* Zone List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading zones…</Text>
        </View>
      ) : (
        <Animated.ScrollView
          style={[styles.list, { opacity: fadeAnim }]}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 30 },
          ]}
          showsVerticalScrollIndicator={false}>
          {safeZones.length === 0 ? (
            <EmptyZones onAddPress={openCreateModal} />
          ) : (
            safeZones.map((zone, index) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                index={index}
                onDelete={handleDeleteZone}
                onFocus={focusZoneOnMap}
              />
            ))
          )}
        </Animated.ScrollView>
      )}

      {/* Create Zone Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="none"
        onRequestClose={closeCreateModal}>
        <BlurView intensity={22} style={StyleSheet.absoluteFill} />
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalContainer, { transform: [{ translateY: modalAnim }] }]}>
            <GradientCard style={styles.modal}>
              {/* Handle */}
              <View style={styles.modalHandle} />

              {/* Title row */}
              <View style={styles.modalHeaderRow}>
                <LinearGradient colors={Gradients.button} style={styles.modalIconBg}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={Colors.accent} />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Create Safe Zone</Text>
                  <Text style={styles.modalSubtitle}>Tap the map to set the center</Text>
                </View>
                <Pressable onPress={closeCreateModal} style={styles.modalCloseBtn} hitSlop={8}>
                  <Ionicons name="close" size={20} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Mini map for location picking */}
              <View style={styles.miniMapWrap}>
                <MapView
                  ref={modalMapRef}
                  provider={PROVIDER_GOOGLE}
                  style={styles.miniMap}
                  customMapStyle={DARK_MAP_STYLE}
                  showsUserLocation
                  showsCompass={false}
                  onPress={handleModalMapPress}
                  initialRegion={mapRegion}>
                  {selectedLocation && (
                    <>
                      <MapCircle
                        center={selectedLocation}
                        radius={radius}
                        fillColor="rgba(0,230,118,0.18)"
                        strokeColor="#00E676"
                        strokeWidth={2}
                      />
                      <Marker coordinate={selectedLocation}>
                        <View style={styles.previewMarker}>
                          <LinearGradient colors={['#00E676', '#00C853']} style={styles.previewMarkerGrad}>
                            <Ionicons name="location" size={13} color="#fff" />
                          </LinearGradient>
                        </View>
                      </Marker>
                    </>
                  )}
                </MapView>

                {/* Crosshair hint when no location picked */}
                {!selectedLocation && (
                  <View style={styles.crosshairOverlay} pointerEvents="none">
                    <View style={styles.crosshairVert} />
                    <View style={styles.crosshairHoriz} />
                    <View style={styles.crosshairHint}>
                      <Ionicons name="finger-print-outline" size={14} color={Colors.accent} />
                      <Text style={styles.crosshairHintText}>Tap to place zone center</Text>
                    </View>
                  </View>
                )}

                {/* Location confirmed badge */}
                {selectedLocation && (
                  <View style={styles.locationConfirmedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                    <Text style={styles.locationConfirmedText}>
                      {formatCoord(selectedLocation.latitude)}, {formatCoord(selectedLocation.longitude)}
                    </Text>
                  </View>
                )}
              </View>

              {/* Zone Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Zone Name</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="shield-outline" size={18} color={Colors.accentSoft} />
                  <TextInput
                    style={styles.textInput}
                    value={zoneName}
                    onChangeText={setZoneName}
                    placeholder="e.g. Home, School, Work"
                    placeholderTextColor={Colors.textMuted}
                    returnKeyType="done"
                  />
                </View>
              </View>

              {/* Radius Slider */}
              <View style={styles.radiusGroup}>
                <View style={styles.radiusHeaderRow}>
                  <Text style={styles.inputLabel}>Radius</Text>
                  <View style={styles.radiusBadge}>
                    <Text style={styles.radiusBadgeText}>{formatRadius(radius)}</Text>
                  </View>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={50}
                  maximumValue={2000}
                  step={50}
                  value={radius}
                  onValueChange={setRadius}
                  minimumTrackTintColor={Colors.accentSoft}
                  maximumTrackTintColor={Colors.bgMid}
                  thumbTintColor={Colors.accent}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabel}>50 m</Text>
                  <Text style={styles.sliderLabel}>2 km</Text>
                </View>
              </View>

              {/* Error */}
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={15} color={Colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Create button */}
              <PremiumButton
                title="Create Safe Zone"
                onPress={handleCreateZone}
                loading={creating}
                disabled={!selectedLocation || !zoneName.trim()}
                icon={<Ionicons name="shield-checkmark-outline" size={18} color="#fff" />}
              />
            </GradientCard>
          </Animated.View>
        </View>
      </Modal>
    </View>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyZones({ onAddPress }) {
  const floatAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -7, duration: 1800, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start()
  }, [])

  return (
    <View style={styles.emptyBox}>
      <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
        <LinearGradient
          colors={['rgba(0,200,83,0.18)', 'rgba(10,92,53,0.08)']}
          style={styles.emptyIconRing}>
          <LinearGradient colors={Gradients.button} style={styles.emptyIconBg}>
            <Ionicons name="shield-outline" size={40} color={Colors.accent} />
          </LinearGradient>
        </LinearGradient>
      </Animated.View>
      <Text style={styles.emptyTitle}>No safe zones yet</Text>
      <Text style={styles.emptyText}>
        Add your first zone to get alerts{'\n'}when family members arrive or leave.
      </Text>
      <Pressable onPress={onAddPress} style={styles.emptyAddBtn}>
        <LinearGradient colors={Gradients.buttonHero} style={styles.emptyAddBtnGrad}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.emptyAddBtnText}>Add First Zone</Text>
        </LinearGradient>
      </Pressable>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: Colors.textWhite },
  headerSubtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  headerShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerShieldText: { color: Colors.accent, fontWeight: '700', fontSize: 14 },

  // Circle switcher chips
  chipScroll: { marginTop: 10 },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgMid,
    overflow: 'hidden',
    position: 'relative',
  },
  chipActive: { borderColor: Colors.borderStrong },
  chipText: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: Colors.textPrimary },

  // Map
  mapContainer: { position: 'relative' },
  map: { flex: 1 },
  mapBottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 56,
  },
  mapBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(5,15,8,0.85)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapBadgeText: { color: Colors.accentSoft, fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    borderRadius: 28,
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
  fabGrad: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  zoneMarker: { alignItems: 'center' },
  zoneMarkerGrad: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.accentSoft,
  },

  // Zone list
  list: { flex: 1 },
  listContent: { padding: 16 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 50, gap: 14 },
  loadingText: { color: Colors.textMuted, fontSize: 14 },

  // Zone card
  zoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  zoneCardMain: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  zoneIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  zoneTextBlock: { flex: 1, gap: 2 },
  zoneName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  zoneRadius: { fontSize: 12, color: Colors.accentSoft, fontWeight: '600' },
  zoneCoords: { fontSize: 11, color: Colors.textMuted, letterSpacing: 0.3 },
  deleteBtn: {
    padding: 9,
    backgroundColor: 'rgba(229,57,53,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.2)',
  },

  // Empty state
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    gap: 14,
  },
  emptyIconRing: {
    width: 110, height: 110, borderRadius: 55,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIconBg: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.borderStrong,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: Colors.textSecondary },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyAddBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 6,
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  emptyAddBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  emptyAddBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Create zone modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContainer: { width: '100%' },
  modal: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    gap: 16,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalIconBg: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  modalSubtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  modalCloseBtn: {
    padding: 6,
    backgroundColor: Colors.bgMid,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Mini map
  miniMapWrap: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  miniMap: { flex: 1 },
  crosshairOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairVert: {
    position: 'absolute',
    width: 1,
    height: 30,
    backgroundColor: 'rgba(0,230,118,0.6)',
  },
  crosshairHoriz: {
    position: 'absolute',
    height: 1,
    width: 30,
    backgroundColor: 'rgba(0,230,118,0.6)',
  },
  crosshairHint: {
    position: 'absolute',
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(5,15,8,0.85)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  crosshairHintText: { color: Colors.accentSoft, fontSize: 12, fontWeight: '600' },
  locationConfirmedBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(5,15,8,0.9)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  locationConfirmedText: { color: Colors.accentSoft, fontSize: 11, fontWeight: '600', flex: 1 },
  previewMarker: { alignItems: 'center' },
  previewMarkerGrad: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },

  // Form fields
  inputGroup: { gap: 8 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.bgMid,
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textInput: { flex: 1, color: Colors.textPrimary, fontSize: 15 },
  radiusGroup: { gap: 8 },
  radiusHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radiusBadge: {
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  radiusBadgeText: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  slider: { width: '100%', height: 36 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  sliderLabel: { color: Colors.textMuted, fontSize: 11 },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(229,57,53,0.1)',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.2)',
  },
  errorText: { color: Colors.danger, fontSize: 13, flex: 1 },
})
