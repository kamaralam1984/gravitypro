import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, Pressable, Animated,
  TextInput, Modal, Dimensions, ActivityIndicator, Alert, Platform
} from 'react-native'
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps'
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

export default function SafeZonesScreen() {
  const insets = useSafeAreaInsets()
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [safeZones, setSafeZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creatingStep, setCreatingStep] = useState(1)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [zoneName, setZoneName] = useState('')
  const [radius, setRadius] = useState(200)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const mapRef = useRef(null)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const modalAnim = useRef(new Animated.Value(300)).current
  const headerAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    loadData()
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await circleAPI.getAll()
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

  const openCreateModal = () => {
    setShowCreateModal(true)
    setCreatingStep(1)
    setSelectedLocation(null)
    setZoneName('')
    setRadius(200)
    setError('')
    Animated.spring(modalAnim, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true }).start()
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const closeCreateModal = () => {
    Animated.timing(modalAnim, { toValue: 300, duration: 250, useNativeDriver: true }).start(() => {
      setShowCreateModal(false)
    })
  }

  const handleMapPress = (e) => {
    if (creatingStep === 1) {
      setSelectedLocation(e.nativeEvent.coordinate)
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  const handleCreateZone = async () => {
    if (!activeCircle) { setError('No circle selected'); return }
    if (!selectedLocation) { setError('Tap on the map to pick a location'); return }
    if (!zoneName.trim()) { setError('Zone name is required'); return }
    setCreating(true); setError('')
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
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await geofenceAPI.delete(zone.id)
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
              await loadZones(activeCircle.id)
            } catch (e) {
              Alert.alert('Error', 'Failed to delete zone')
            }
          }
        }
      ]
    )
  }

  const formatRadius = (r) => r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <Animated.View style={[styles.header, { paddingTop: insets.top + 12, opacity: headerAnim }]}>
        <LinearGradient colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.85)']} style={StyleSheet.absoluteFill} />
        <Text style={styles.headerTitle}>Safe Zones</Text>
        <Text style={styles.headerSubtitle}>
          {safeZones.length} zone{safeZones.length !== 1 ? 's' : ''} active
          {activeCircle ? ` in ${activeCircle.name}` : ''}
        </Text>
      </Animated.View>

      {/* Map Preview */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          customMapStyle={DARK_MAP_STYLE}
          showsUserLocation
          showsCompass={false}
          onPress={handleMapPress}>
          {safeZones.map(zone => (
            <React.Fragment key={zone.id}>
              <Circle
                center={{ latitude: zone.center_lat, longitude: zone.center_lng }}
                radius={zone.radius_meters}
                fillColor="rgba(0,200,83,0.12)"
                strokeColor="#00C853"
                strokeWidth={2}
              />
              <Marker
                coordinate={{ latitude: zone.center_lat, longitude: zone.center_lng }}
                title={zone.name}>
                <View style={styles.zoneMarker}>
                  <LinearGradient colors={['#0D7A45', '#0A5C35']} style={styles.zoneMarkerGrad}>
                    <Ionicons name="shield-checkmark" size={14} color={Colors.accent} />
                  </LinearGradient>
                </View>
              </Marker>
            </React.Fragment>
          ))}
          {selectedLocation && showCreateModal && (
            <>
              <Circle
                center={selectedLocation}
                radius={radius}
                fillColor="rgba(0,230,118,0.15)"
                strokeColor="#00E676"
                strokeWidth={2}
              />
              <Marker coordinate={selectedLocation}>
                <View style={styles.previewMarker}>
                  <LinearGradient colors={['#00E676', '#00C853']} style={styles.previewMarkerGrad}>
                    <Ionicons name="location" size={14} color="#fff" />
                  </LinearGradient>
                </View>
              </Marker>
            </>
          )}
        </MapView>
        <LinearGradient colors={['rgba(2,12,5,0)', 'rgba(2,12,5,0.9)']} style={styles.mapOverlay} pointerEvents="none" />
        <Pressable style={styles.addZoneBtn} onPress={openCreateModal}>
          <LinearGradient colors={Gradients.buttonHero} style={styles.addZoneBtnGrad}>
            <Ionicons name="add" size={26} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>

      {/* Zones List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : (
        <Animated.FlatList
          style={{ opacity: fadeAnim }}
          data={safeZones}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="shield-outline" size={60} color={Colors.accentDim} />
              <Text style={styles.emptyTitle}>No Safe Zones</Text>
              <Text style={styles.emptyText}>Tap + to create your first safe zone</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <ZoneCard zone={item} index={index} onDelete={() => handleDeleteZone(item)} />
          )}
        />
      )}

      {/* Create Zone Modal */}
      <Modal visible={showCreateModal} transparent animationType="none" onRequestClose={closeCreateModal}>
        <BlurView intensity={20} style={StyleSheet.absoluteFill} />
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalContainer, { transform: [{ translateY: modalAnim }] }]}>
            <GradientCard style={styles.modal}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create Safe Zone</Text>
                <Pressable onPress={closeCreateModal} style={styles.modalClose}>
                  <Ionicons name="close" size={22} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Step 1: Pick location */}
              <View style={styles.stepRow}>
                <View style={[styles.stepDot, creatingStep >= 1 && styles.stepDotActive]}>
                  <Text style={styles.stepNum}>1</Text>
                </View>
                <Text style={styles.stepLabel}>Tap map to pick center</Text>
                {selectedLocation && <Ionicons name="checkmark-circle" size={20} color={Colors.success} />}
              </View>

              {/* Zone Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Zone Name</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="shield-outline" size={18} color={Colors.accentSoft} style={{ marginRight: 10 }} />
                  <TextInput
                    style={styles.textInput}
                    value={zoneName}
                    onChangeText={setZoneName}
                    placeholder="e.g. Home, School, Work"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
              </View>

              {/* Radius Slider */}
              <View style={styles.radiusGroup}>
                <View style={styles.radiusHeader}>
                  <Text style={styles.inputLabel}>Radius</Text>
                  <View style={styles.radiusBadge}>
                    <Text style={styles.radiusBadgeText}>{formatRadius(radius)}</Text>
                  </View>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={50}
                  maximumValue={5000}
                  step={50}
                  value={radius}
                  onValueChange={setRadius}
                  minimumTrackTintColor={Colors.accentSoft}
                  maximumTrackTintColor={Colors.bgMid}
                  thumbTintColor={Colors.accent}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabel}>50m</Text>
                  <Text style={styles.sliderLabel}>5km</Text>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <PremiumButton
                title="Create Safe Zone"
                onPress={handleCreateZone}
                loading={creating}
                disabled={!selectedLocation || !zoneName.trim()}
                icon={<Ionicons name="shield-checkmark-outline" size={20} color="#fff" />}
              />
            </GradientCard>
          </Animated.View>
        </View>
      </Modal>
    </View>
  )
}

function ZoneCard({ zone, index, onDelete }) {
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

  const formatRadius = (r) => r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 12 }}>
      <GradientCard style={styles.zoneCard}>
        <View style={styles.zoneCardLeft}>
          <LinearGradient colors={['rgba(0,200,83,0.2)', 'rgba(0,200,83,0.05)']} style={styles.zoneIconWrap}>
            <Ionicons name="shield-checkmark" size={22} color={Colors.accentSoft} />
          </LinearGradient>
          <View>
            <Text style={styles.zoneName}>{zone.name}</Text>
            <Text style={styles.zoneRadius}>Radius: {formatRadius(zone.radius_meters)}</Text>
          </View>
        </View>
        <Pressable onPress={onDelete} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={18} color={Colors.danger} />
        </Pressable>
      </GradientCard>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  header: { paddingHorizontal: 24, paddingBottom: 14, zIndex: 10 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: Colors.textWhite },
  headerSubtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  mapContainer: { height: height * 0.38, position: 'relative' },
  map: { flex: 1 },
  mapOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60 },
  addZoneBtn: { position: 'absolute', bottom: 16, right: 16, borderRadius: 28, shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 12 },
  addZoneBtnGrad: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  zoneMarker: { alignItems: 'center' },
  zoneMarkerGrad: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.accentSoft },
  previewMarker: { alignItems: 'center' },
  previewMarkerGrad: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  list: { padding: 16 },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.textSecondary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  zoneCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  zoneCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  zoneIconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  zoneName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  zoneRadius: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  deleteBtn: { padding: 8, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContainer: { width: '100%' },
  modal: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, gap: 18 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  modalClose: { padding: 4, backgroundColor: Colors.bgMid, borderRadius: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgMid, borderRadius: 14, padding: 14 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.bgCard, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { borderColor: Colors.accent, backgroundColor: Colors.bgGlassStrong },
  stepNum: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  stepLabel: { flex: 1, fontSize: 14, color: Colors.textSecondary },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgMid, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  textInput: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  radiusGroup: { gap: 10 },
  radiusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radiusBadge: { backgroundColor: Colors.bgGlassStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  radiusBadgeText: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  slider: { width: '100%', height: 40 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { color: Colors.textMuted, fontSize: 11 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 12, padding: 12 },
  errorText: { color: Colors.danger, fontSize: 13, flex: 1 },
})
