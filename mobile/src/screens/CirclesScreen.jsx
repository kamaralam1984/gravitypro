import React, { useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, ScrollView, Animated, Pressable, TextInput, Modal, ActivityIndicator, Image, Alert, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { circleAPI, mediaAPI } from '../services/api'
import { PremiumButton } from '../components/ui/PremiumButton'
import { GradientCard } from '../components/ui/GradientCard'
import { Colors, Gradients } from '../theme/colors'

export default function CirclesScreen() {
  const insets = useSafeAreaInsets()
  const [circles, setCircles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [circleName, setCircleName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(30)).current

  useEffect(() => {
    loadCircles()
  }, [])

  const loadCircles = async () => {
    setLoading(true)
    try {
      const res = await circleAPI.getAll()
      setCircles(res.circles || [])
    } catch (e) {
      console.error('Failed to load circles', e)
    } finally {
      setLoading(false)
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start()
    }
  }

  const handleCreateCircle = async () => {
    if (!circleName.trim()) { setError('Circle name is required'); return }
    setActionLoading(true)
    setError('')
    try {
      await circleAPI.create({ name: circleName.trim() })
      setShowCreateModal(false)
      setCircleName('')
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await loadCircles()
    } catch (e) {
      setError(e.error || 'Failed to create circle')
    } finally {
      setActionLoading(false)
    }
  }

  const handleJoinCircle = async () => {
    if (!inviteCode.trim()) { setError('Invite code is required'); return }
    setActionLoading(true)
    setError('')
    try {
      await circleAPI.join(inviteCode.trim().toUpperCase())
      setShowJoinModal(false)
      setInviteCode('')
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await loadCircles()
    } catch (e) {
      setError(e.error || 'Invalid invite code')
    } finally {
      setActionLoading(false)
    }
  }

  const handleIconUpdated = (circleId, iconUrl) => {
    setCircles(prev => prev.map(c => c.id === circleId ? { ...c, icon_url: iconUrl } : c))
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <LinearGradient colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.9)']} style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>My Circles</Text>
        <Text style={styles.headerSubtitle}>Your family groups</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        ) : (
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            {circles.length === 0 && (
              <View style={styles.emptyBox}>
                <Ionicons name="people-outline" size={64} color={Colors.accentDim} />
                <Text style={styles.emptyTitle}>No circles yet</Text>
                <Text style={styles.emptyText}>Create or join a family circle to get started</Text>
              </View>
            )}
            {circles.map((circle, index) => (
              <CircleCard key={circle.id} circle={circle} index={index} onIconUpdated={handleIconUpdated} />
            ))}
          </Animated.View>
        )}

        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn} onPress={() => { setShowCreateModal(true); setError('') }}>
            <LinearGradient colors={Gradients.buttonHero} style={styles.actionBtnGradient}>
              <Ionicons name="add-circle" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>Create Circle</Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={() => { setShowJoinModal(true); setError('') }}>
            <View style={styles.actionBtnGradient}>
              <Ionicons name="enter-outline" size={22} color={Colors.accent} />
              <Text style={[styles.actionBtnText, { color: Colors.accent }]}>Join Circle</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>

      {/* Create Circle Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <BlurView intensity={30} style={StyleSheet.absoluteFill} />
        <View style={styles.modalOverlay}>
          <GradientCard style={styles.modal}>
            <Text style={styles.modalTitle}>Create a Circle</Text>
            <Text style={styles.modalSubtitle}>Name your family group</Text>
            <View style={styles.modalInput}>
              <Ionicons name="people" size={20} color={Colors.accentSoft} />
              <TextInput
                style={styles.modalTextInput}
                value={circleName}
                onChangeText={setCircleName}
                placeholder="e.g. Smith Family"
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
            </View>
            {error ? <Text style={styles.modalError}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <PremiumButton title="Create" onPress={handleCreateCircle} loading={actionLoading} style={{ flex: 1 }} />
            </View>
          </GradientCard>
        </View>
      </Modal>

      {/* Join Circle Modal */}
      <Modal visible={showJoinModal} transparent animationType="fade">
        <BlurView intensity={30} style={StyleSheet.absoluteFill} />
        <View style={styles.modalOverlay}>
          <GradientCard style={styles.modal}>
            <Text style={styles.modalTitle}>Join a Circle</Text>
            <Text style={styles.modalSubtitle}>Enter your family invite code</Text>
            <View style={styles.modalInput}>
              <Ionicons name="key-outline" size={20} color={Colors.accentSoft} />
              <TextInput
                style={styles.modalTextInput}
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="XXXXXXXX"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoFocus
              />
            </View>
            {error ? <Text style={styles.modalError}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setShowJoinModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <PremiumButton title="Join" onPress={handleJoinCircle} loading={actionLoading} style={{ flex: 1 }} />
            </View>
          </GradientCard>
        </View>
      </Modal>
    </View>
  )
}

function CircleCard({ circle, index, onIconUpdated }) {
  const slideAnim = useRef(new Animated.Value(40)).current
  const fadeAnim = useRef(new Animated.Value(0)).current
  const [uploadingIcon, setUploadingIcon] = useState(false)

  useEffect(() => {
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, index * 80)
  }, [])

  const handleIconPress = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library to set a circle icon.')
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      })
      if (result.canceled) return
      const asset = result.assets[0]
      setUploadingIcon(true)
      const contentType = asset.mimeType || 'image/jpeg'
      const fileSize = asset.fileSize || 0
      const presignRes = await mediaAPI.presignCircleIcon(circle.id, contentType, fileSize)
      const { uploadUrl, publicUrl } = presignRes
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: await fetch(asset.uri).then(r => r.blob()),
      })
      if (!uploadRes.ok) throw new Error('Upload failed')
      await mediaAPI.confirmCircleIcon(circle.id, publicUrl)
      onIconUpdated(circle.id, publicUrl)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Upload failed', 'Could not update circle icon. Please try again.')
    } finally {
      setUploadingIcon(false)
    }
  }

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 14 }}>
      <GradientCard style={styles.circleCard}>
        <View style={styles.circleCardHeader}>
          {/* Circle icon: real image if available, else gradient placeholder */}
          <View style={styles.circleIconWrap}>
            {circle.icon_url ? (
              <Image source={{ uri: circle.icon_url }} style={styles.circleIconImage} />
            ) : (
              <LinearGradient colors={Gradients.button} style={styles.circleIcon}>
                <Ionicons name="people" size={22} color={Colors.accent} />
              </LinearGradient>
            )}
            {/* Camera button overlay */}
            <Pressable
              onPress={handleIconPress}
              style={styles.cameraBtn}
              disabled={uploadingIcon}>
              {uploadingIcon ? (
                <ActivityIndicator size={10} color="#fff" />
              ) : (
                <Ionicons name="camera" size={12} color="#fff" />
              )}
            </Pressable>
          </View>

          <View style={styles.circleInfo}>
            <Text style={styles.circleName}>{circle.name}</Text>
            <Text style={styles.circleCode}>Code: {circle.invite_code}</Text>
          </View>
          <View style={styles.circleMemberCount}>
            <Text style={styles.circleMemberNum}>{circle.member_count || 0}</Text>
            <Text style={styles.circleMemberLabel}>members</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.circleCardFooter}>
          <Ionicons name="shield-checkmark" size={14} color={Colors.accentSoft} />
          <Text style={styles.circleStatus}>Active - Location sharing on</Text>
        </View>
      </GradientCard>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  header: { paddingHorizontal: 24, paddingBottom: 16 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: Colors.textWhite },
  headerSubtitle: { fontSize: 14, color: Colors.textMuted, marginTop: 2 },
  scroll: { padding: 20, paddingBottom: 100 },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.textSecondary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  circleCard: { padding: 18 },
  circleCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  circleIconWrap: { position: 'relative', width: 48, height: 48 },
  circleIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  circleIconImage: { width: 48, height: 48, borderRadius: 14, resizeMode: 'cover' },
  cameraBtn: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.bgDeep,
  },
  circleInfo: { flex: 1 },
  circleName: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  circleCode: { fontSize: 12, color: Colors.textMuted, marginTop: 2, letterSpacing: 0.5 },
  circleMemberCount: { alignItems: 'center' },
  circleMemberNum: { fontSize: 22, fontWeight: '800', color: Colors.accent },
  circleMemberLabel: { fontSize: 11, color: Colors.textMuted },
  divider: { height: 1, backgroundColor: Colors.divider, marginVertical: 14 },
  circleCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  circleStatus: { fontSize: 13, color: Colors.textMuted },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  actionBtn: { flex: 1, borderRadius: 16, overflow: 'hidden', shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  actionBtnSecondary: { borderWidth: 1, borderColor: Colors.borderStrong, backgroundColor: Colors.bgCard },
  actionBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { width: '100%', padding: 24, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  modalSubtitle: { fontSize: 14, color: Colors.textMuted, marginTop: -8 },
  modalInput: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.bgMid, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  modalTextInput: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  modalError: { color: Colors.danger, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  modalCancel: { paddingHorizontal: 20, paddingVertical: 16 },
  modalCancelText: { color: Colors.textMuted, fontSize: 15, fontWeight: '600' },
})
