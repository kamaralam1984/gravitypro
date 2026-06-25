import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, Pressable, Animated, ScrollView,
  TextInput, Modal, Dimensions, ActivityIndicator, Alert, Platform,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import Slider from '@react-native-community/slider'
import { circleAPI, geofenceAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { ZONE_CATEGORIES, categoryMeta, groupZonesByMember } from '../services/zonesApi'
import { GradientCard } from '../components/ui/GradientCard'
import { PremiumButton } from '../components/ui/PremiumButton'
import { useTheme } from '../theme/ThemeContext'
import FamilyMap, { haversineMeters, formatDistance } from '../components/FamilyMap'
import * as Location from 'expo-location'

const { width, height } = Dimensions.get('window')
const MAP_HEIGHT = height * 0.45

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatRadius = (r) => r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`

const formatCoord = (n) => (Math.round(n * 10000) / 10000).toFixed(4)

// ─── Zone Card ────────────────────────────────────────────────────────────────

function ZoneCard({ zone, index, onDelete, onFocus, onEdit, memberStats, isChild }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
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

  const located = memberStats || []
  const insideCount = located.filter(s => s.inside).length
  const cat = categoryMeta(zone.category)
  const assignLabel = zone.assigned_user_id
    ? (zone.assigned_user_name || 'Assigned')
    : 'Shared'

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 12 }}>
      <GradientCard style={styles.zoneCard}>
        <View style={styles.zoneCardRow}>
          <Pressable onPress={() => onFocus(zone)} style={styles.zoneCardMain}>
            <LinearGradient
              colors={['rgba(0,200,83,0.22)', 'rgba(0,200,83,0.07)']}
              style={styles.zoneIconWrap}>
              <Ionicons name={cat.icon} size={22} color={c.accentSoft} />
            </LinearGradient>

            <View style={styles.zoneTextBlock}>
              <Text style={styles.zoneName}>{zone.name}</Text>
              <Text style={styles.zoneRadius}>{formatRadius(Number(zone.radius_meters))} radius</Text>
              <View style={styles.zoneTagRow}>
                <View style={styles.zoneTag}>
                  <Ionicons name={cat.icon} size={10} color={c.accentSoft} />
                  <Text style={styles.zoneTagText}>{cat.label}</Text>
                </View>
                <View style={[styles.zoneTag, zone.assigned_user_id && styles.zoneTagAssigned]}>
                  <Ionicons
                    name={zone.assigned_user_id ? 'person' : 'people'}
                    size={10}
                    color={zone.assigned_user_id ? c.accent : c.textMuted}
                  />
                  <Text style={[styles.zoneTagText, zone.assigned_user_id && styles.zoneTagTextAssigned]} numberOfLines={1}>
                    {assignLabel}
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>

          {/* A child can VIEW zones but not edit/delete them. */}
          {!isChild && (
            <View style={styles.zoneActions}>
              <Pressable onPress={() => onEdit(zone)} style={styles.editBtn} hitSlop={6}>
                <Ionicons name="create-outline" size={18} color={c.accent} />
              </Pressable>
              <Pressable onPress={() => onDelete(zone)} style={styles.deleteBtn} hitSlop={6}>
                <Ionicons name="trash-outline" size={18} color={c.danger} />
              </Pressable>
            </View>
          )}
        </View>

        {located.length > 0 && (
          <View style={styles.zoneMembers}>
            <View style={styles.zoneMembersHeader}>
              <Ionicons name="people" size={13} color={c.accentSoft} />
              <Text style={styles.zoneMembersSummary}>
                {insideCount} of {located.length} inside
              </Text>
            </View>
            {located.map(s => (
              <View key={s.id} style={styles.zoneMemberRow}>
                <View
                  style={[
                    styles.zoneMemberDot,
                    { backgroundColor: s.inside ? c.accent : c.textMuted },
                  ]}
                />
                <Text style={styles.zoneMemberName} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.zoneMemberDist, s.inside && styles.zoneMemberDistInside]}>
                  {s.inside ? 'inside' : formatDistance(s.distance)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </GradientCard>
    </Animated.View>
  )
}

// ─── Circle Chip ─────────────────────────────────────────────────────────────

function CircleChip({ circle, active, onPress }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      {active && (
        <LinearGradient colors={c.gradients.button} style={StyleSheet.absoluteFill} borderRadius={20} />
      )}
      <Ionicons
        name="people"
        size={13}
        color={active ? c.accent : c.textMuted}
      />
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{circle.name}</Text>
    </Pressable>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SafeZonesScreen() {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  // Only a parent can create/edit/delete safe zones; a child can only VIEW them.
  const isChild = useAuthStore(s => s.user?.account_type) === 'child'
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [safeZones, setSafeZones] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [zoneName, setZoneName] = useState('')
  const [radius, setRadius] = useState(200)
  const [assignedUserId, setAssignedUserId] = useState(null) // null = shared (whole circle)
  const [category, setCategory] = useState('other')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [pickingOnMap, setPickingOnMap] = useState(false)
  const [editingZone, setEditingZone] = useState(null)
  const [myLocation, setMyLocation] = useState(null)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const headerAnim = useRef(new Animated.Value(0)).current
  const modalAnim = useRef(new Animated.Value(350)).current

  useEffect(() => {
    loadData()
    Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start()
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') return
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      } catch (_) {}
    })()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await circleAPI.getMy()
      const circs = res.circles || []
      setCircles(circs)
      if (circs.length) {
        setActiveCircle(circs[0])
        await Promise.all([loadZones(circs[0].id), loadMembers(circs[0].id)])
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

  const loadMembers = async (circleId) => {
    try {
      const res = await circleAPI.getMembers(circleId)
      setMembers(res.members || res || [])
    } catch (e) {
      console.error('Load members error', e)
      setMembers([])
    }
  }

  const switchCircle = async (circle) => {
    if (circle.id === activeCircle?.id) return
    if (Platform.OS !== 'web') Haptics.selectionAsync()
    setActiveCircle(circle)
    setSafeZones([])
    setMembers([])
    await Promise.all([loadZones(circle.id), loadMembers(circle.id)])
  }

  // Per-zone member stats: distance from each located member to the zone center.
  const statsForZone = useCallback((zone) => {
    const cLat = Number(zone.center_lat)
    const cLng = Number(zone.center_lng)
    const radius = Number(zone.radius_meters)
    return (members || [])
      .filter(m => m.latitude != null && m.longitude != null)
      .map(m => {
        const distance = haversineMeters(cLat, cLng, Number(m.latitude), Number(m.longitude))
        return {
          id: m.id,
          name: m.name || m.email || 'Member',
          distance,
          inside: distance <= radius,
        }
      })
      .sort((a, b) => a.distance - b.distance)
  }, [members])

  // The display map (FamilyMap) auto-fits to all zones, so focusing just nudges
  // the focused zone to the front of the list so it renders first / centers.
  const focusZoneOnMap = useCallback((zone) => {
    setSafeZones((prev) => {
      const rest = prev.filter((z) => z.id !== zone.id)
      return [zone, ...rest]
    })
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  const openCreateModal = () => {
    setEditingZone(null)
    setShowCreateModal(true)
    // Default the new zone center to the user's current location (if known).
    setSelectedLocation(myLocation ? { ...myLocation } : null)
    setZoneName('')
    setRadius(200)
    setAssignedUserId(null)
    setCategory('other')
    setError('')
    setPickingOnMap(false)
    Animated.spring(modalAnim, { toValue: 0, tension: 65, friction: 10, useNativeDriver: true }).start()
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const openEditModal = (zone) => {
    setEditingZone(zone)
    setShowCreateModal(true)
    setSelectedLocation({ latitude: Number(zone.center_lat), longitude: Number(zone.center_lng) })
    setZoneName(zone.name)
    setRadius(Number(zone.radius_meters))
    setAssignedUserId(zone.assigned_user_id ?? null)
    setCategory(zone.category || 'other')
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

  // Called by FamilyMap (pickMode) when the user taps the Leaflet map.
  const handlePickLocation = (coord) => {
    setSelectedLocation({
      latitude: Number(coord.latitude),
      longitude: Number(coord.longitude),
    })
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
      const payload = {
        name: zoneName.trim(),
        center_lat: Number(selectedLocation.latitude),
        center_lng: Number(selectedLocation.longitude),
        radius_meters: Number(radius),
        assigned_user_id: assignedUserId ?? null, // null = shared with whole circle
        category,
      }
      if (editingZone) {
        await geofenceAPI.update(editingZone.id, payload)
      } else {
        await geofenceAPI.create({ circle_id: activeCircle.id, ...payload })
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      closeCreateModal()
      setEditingZone(null)
      await loadZones(activeCircle.id)
    } catch (e) {
      setError(e.error || `Failed to ${editingZone ? 'update' : 'create'} safe zone`)
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

  // Members that have a known location, mapped to FamilyMap's shape.
  const mappedMembers = (members || [])
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => ({
      id: m.id,
      name: m.name || m.email || 'Member',
      latitude: Number(m.latitude),
      longitude: Number(m.longitude),
      battery_level: m.battery_level ?? null,
      account_type: m.account_type,
    }))

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />

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
            <Ionicons name="shield-checkmark" size={16} color={c.accent} />
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

      {/* Map — top 45% (free Leaflet/OSM via FamilyMap) */}
      <View style={[styles.mapContainer, { height: MAP_HEIGHT }]}>
        <FamilyMap
          style={[styles.map, { borderRadius: 0, borderWidth: 0 }]}
          zones={safeZones}
          members={mappedMembers}
          me={myLocation}
        />

        {/* Gradient fade at bottom of map */}
        <LinearGradient
          colors={['transparent', 'rgba(2,12,5,0.85)']}
          style={styles.mapBottomFade}
          pointerEvents="none"
        />

        {/* Zone count overlay */}
        {safeZones.length > 0 && (
          <View style={styles.mapBadge}>
            <Ionicons name="shield-checkmark" size={12} color={c.accent} />
            <Text style={styles.mapBadgeText}>{safeZones.length} zones</Text>
          </View>
        )}

        {/* FAB on map — parent only (children can only view zones) */}
        {!isChild && (
          <Pressable style={styles.fab} onPress={openCreateModal}>
            <LinearGradient colors={c.gradients.buttonHero} style={styles.fabGrad}>
              <Ionicons name="add" size={26} color="#fff" />
            </LinearGradient>
          </Pressable>
        )}
      </View>

      {/* Zone List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={c.accent} />
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
            <EmptyZones onAddPress={openCreateModal} isChild={isChild} />
          ) : (
            (() => {
              let i = 0
              return groupZonesByMember(safeZones, members).map((group) => (
                <View key={group.key} style={styles.groupBlock}>
                  <View style={styles.groupHeader}>
                    <Ionicons
                      name={group.userId ? 'person-circle' : 'people-circle'}
                      size={16}
                      color={c.accentSoft}
                    />
                    <Text style={styles.groupTitle}>{group.name}</Text>
                    <Text style={styles.groupCount}>{group.zones.length}</Text>
                  </View>
                  {group.zones.map((zone) => (
                    <ZoneCard
                      key={zone.id}
                      zone={zone}
                      index={i++}
                      onDelete={handleDeleteZone}
                      onFocus={focusZoneOnMap}
                      onEdit={openEditModal}
                      memberStats={statsForZone(zone)}
                      isChild={isChild}
                    />
                  ))}
                </View>
              ))
            })()
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
                <LinearGradient colors={c.gradients.button} style={styles.modalIconBg}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={c.accent} />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{editingZone ? 'Edit Safe Zone' : 'Create Safe Zone'}</Text>
                  <Text style={styles.modalSubtitle}>Tap the map to set the center</Text>
                </View>
                <Pressable onPress={closeCreateModal} style={styles.modalCloseBtn} hitSlop={8}>
                  <Ionicons name="close" size={20} color={c.textMuted} />
                </Pressable>
              </View>

              {/* Mini map for location picking (tap the Leaflet map) */}
              <View style={styles.miniMapWrap}>
                <FamilyMap
                  style={[styles.miniMap, { borderRadius: 0, borderWidth: 0 }]}
                  zones={[]}
                  members={[]}
                  me={myLocation}
                  pickMode
                  pick={
                    selectedLocation
                      ? {
                          latitude: Number(selectedLocation.latitude),
                          longitude: Number(selectedLocation.longitude),
                          radius: Number(radius),
                        }
                      : null
                  }
                  onPickLocation={handlePickLocation}
                />

                {/* Crosshair hint when no location picked */}
                {!selectedLocation && (
                  <View style={styles.crosshairOverlay} pointerEvents="none">
                    <View style={styles.crosshairVert} />
                    <View style={styles.crosshairHoriz} />
                    <View style={styles.crosshairHint}>
                      <Ionicons name="finger-print-outline" size={14} color={c.accent} />
                      <Text style={styles.crosshairHintText}>Tap to place zone center</Text>
                    </View>
                  </View>
                )}

                {/* Location confirmed badge */}
                {selectedLocation && (
                  <View style={styles.locationConfirmedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={c.success} />
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
                  <Ionicons name="shield-outline" size={18} color={c.accentSoft} />
                  <TextInput
                    style={styles.textInput}
                    value={zoneName}
                    onChangeText={setZoneName}
                    placeholder="e.g. Home, School, Work"
                    placeholderTextColor={c.textMuted}
                    returnKeyType="done"
                  />
                </View>
              </View>

              {/* Assign to member */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Assign To</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pickerRow}>
                  <Pressable
                    onPress={() => setAssignedUserId(null)}
                    style={[styles.pickerChip, assignedUserId == null && styles.pickerChipActive]}>
                    <Ionicons
                      name="people"
                      size={13}
                      color={assignedUserId == null ? c.accent : c.textMuted}
                    />
                    <Text style={[styles.pickerChipText, assignedUserId == null && styles.pickerChipTextActive]}>
                      Whole family
                    </Text>
                  </Pressable>
                  {(members || []).map((m) => {
                    const on = assignedUserId === m.id
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => setAssignedUserId(m.id)}
                        style={[styles.pickerChip, on && styles.pickerChipActive]}>
                        <Ionicons name="person" size={13} color={on ? c.accent : c.textMuted} />
                        <Text style={[styles.pickerChipText, on && styles.pickerChipTextActive]} numberOfLines={1}>
                          {m.name || m.email || 'Member'}
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>
              </View>

              {/* Category */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pickerRow}>
                  {ZONE_CATEGORIES.map((cat) => {
                    const on = category === cat.value
                    return (
                      <Pressable
                        key={cat.value}
                        onPress={() => setCategory(cat.value)}
                        style={[styles.pickerChip, on && styles.pickerChipActive]}>
                        <Ionicons name={cat.icon} size={13} color={on ? c.accent : c.textMuted} />
                        <Text style={[styles.pickerChipText, on && styles.pickerChipTextActive]}>
                          {cat.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>
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
                  minimumTrackTintColor={c.accentSoft}
                  maximumTrackTintColor={c.bgMid}
                  thumbTintColor={c.accent}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabel}>50 m</Text>
                  <Text style={styles.sliderLabel}>2 km</Text>
                </View>
              </View>

              {/* Error */}
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={15} color={c.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Create button */}
              <PremiumButton
                title={editingZone ? 'Save Changes' : 'Create Safe Zone'}
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

function EmptyZones({ onAddPress, isChild }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
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
          <LinearGradient colors={c.gradients.button} style={styles.emptyIconBg}>
            <Ionicons name="shield-outline" size={40} color={c.accent} />
          </LinearGradient>
        </LinearGradient>
      </Animated.View>
      <Text style={styles.emptyTitle}>No safe zones yet</Text>
      <Text style={styles.emptyText}>
        {isChild
          ? 'Safe zones set up by your family\nwill appear here.'
          : `Add your first zone to get alerts\nwhen family members arrive or leave.`}
      </Text>
      {!isChild && (
        <Pressable onPress={onAddPress} style={styles.emptyAddBtn}>
          <LinearGradient colors={c.gradients.buttonHero} style={styles.emptyAddBtnGrad}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.emptyAddBtnText}>Add First Zone</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep },

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
  headerTitle: { fontSize: 26, fontWeight: '800', color: c.textWhite },
  headerSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  headerShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: c.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.border,
  },
  headerShieldText: { color: c.accent, fontWeight: '700', fontSize: 14 },

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
    borderColor: c.border,
    backgroundColor: c.bgMid,
    overflow: 'hidden',
    position: 'relative',
  },
  chipActive: { borderColor: c.borderStrong },
  chipText: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  chipTextActive: { color: c.textPrimary },

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
    borderColor: c.border,
  },
  mapBadgeText: { color: c.accentSoft, fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    borderRadius: 28,
    shadowColor: c.accentSoft,
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
    borderWidth: 2, borderColor: c.accentSoft,
  },

  // Zone list
  list: { flex: 1 },
  listContent: { padding: 16 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 50, gap: 14 },
  loadingText: { color: c.textMuted, fontSize: 14 },

  // Zone card
  zoneCard: {
    padding: 16,
  },
  zoneCardRow: { flexDirection: 'row', alignItems: 'center' },
  zoneCardMain: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  zoneIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  zoneTextBlock: { flex: 1, gap: 2 },
  zoneName: { fontSize: 16, fontWeight: '700', color: c.textPrimary },
  zoneRadius: { fontSize: 12, color: c.accentSoft, fontWeight: '600' },
  zoneCoords: { fontSize: 11, color: c.textMuted, letterSpacing: 0.3 },
  zoneTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  zoneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.bgMid,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: c.border,
    maxWidth: 150,
  },
  zoneTagAssigned: { borderColor: c.borderStrong, backgroundColor: 'rgba(0,200,83,0.08)' },
  zoneTagText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
  zoneTagTextAssigned: { color: c.accent },
  zoneActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  // Grouped-by-member sections
  groupBlock: { marginBottom: 6 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
    marginTop: 4,
  },
  groupTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: c.textSecondary, letterSpacing: 0.3 },
  groupCount: {
    fontSize: 11,
    fontWeight: '700',
    color: c.accentSoft,
    backgroundColor: c.bgGlassStrong,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  // Member / category pickers (modal)
  pickerRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  pickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bgMid,
    maxWidth: 170,
  },
  pickerChipActive: { borderColor: c.borderStrong, backgroundColor: 'rgba(0,200,83,0.1)' },
  pickerChipText: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  pickerChipTextActive: { color: c.accent, fontWeight: '700' },
  editBtn: {
    padding: 9,
    backgroundColor: 'rgba(0,200,83,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.2)',
  },
  deleteBtn: {
    padding: 9,
    backgroundColor: 'rgba(229,57,53,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.2)',
  },

  // Per-zone member stats
  zoneMembers: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    gap: 7,
  },
  zoneMembersHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  zoneMembersSummary: { fontSize: 12, color: c.accentSoft, fontWeight: '700' },
  zoneMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zoneMemberDot: { width: 7, height: 7, borderRadius: 4 },
  zoneMemberName: { flex: 1, fontSize: 13, color: c.textSecondary },
  zoneMemberDist: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  zoneMemberDistInside: { color: c.accent, fontWeight: '700' },

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
    borderWidth: 2, borderColor: c.borderStrong,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: c.textSecondary },
  emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyAddBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 6,
    shadowColor: c.accentSoft,
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
    backgroundColor: c.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalIconBg: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary },
  modalSubtitle: { fontSize: 12, color: c.textMuted, marginTop: 1 },
  modalCloseBtn: {
    padding: 6,
    backgroundColor: c.bgMid,
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
    borderColor: c.border,
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
    borderColor: c.border,
  },
  crosshairHintText: { color: c.accentSoft, fontSize: 12, fontWeight: '600' },
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
    borderColor: c.borderStrong,
  },
  locationConfirmedText: { color: c.accentSoft, fontSize: 11, fontWeight: '600', flex: 1 },
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
    color: c.textMuted,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgMid,
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: c.border,
  },
  textInput: { flex: 1, color: c.textPrimary, fontSize: 15 },
  radiusGroup: { gap: 8 },
  radiusHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radiusBadge: {
    backgroundColor: c.bgGlassStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: c.border,
  },
  radiusBadgeText: { color: c.accent, fontSize: 14, fontWeight: '700' },
  slider: { width: '100%', height: 36 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  sliderLabel: { color: c.textMuted, fontSize: 11 },
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
  errorText: { color: c.danger, fontSize: 13, flex: 1 },
})
