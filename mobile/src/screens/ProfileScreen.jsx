import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable, Animated,
  Switch, Image, Alert, Platform, TextInput, ActivityIndicator,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { useAuthStore } from '../store/authStore'
import { mediaAPI, userAPI, subscriptionAPI } from '../services/api'
import { stopBackgroundTracking } from '../services/location'
import { GradientCard } from '../components/ui/GradientCard'
import { Colors, Gradients } from '../theme/colors'

export default function ProfileScreen() {
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
  const logout = useAuthStore(s => s.logout)
  const insets = useSafeAreaInsets()

  // Avatar
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // Profile editing
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(user?.name || '')
  const [savingName, setSavingName] = useState(false)

  // Subscription
  const [subscription, setSubscription] = useState(null)
  const [loadingSub, setLoadingSub] = useState(true)

  // Settings toggles
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current
  const avatarScale = useRef(new Animated.Value(0.8)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(avatarScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start()

    // Load subscription
    subscriptionAPI.getMe()
      .then(data => setSubscription(data))
      .catch(() => setSubscription(null))
      .finally(() => setLoadingSub(false))
  }, [])

  // Keep nameValue in sync if user updates externally
  useEffect(() => {
    if (!editingName) setNameValue(user?.name || '')
  }, [user?.name, editingName])

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to update your profile picture.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setUploadingAvatar(true)
    try {
      const ext = asset.uri.split('.').pop().toLowerCase()
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
      // Step 1: Get presigned URL
      const { uploadUrl, publicUrl } = await mediaAPI.getAvatarUploadUrl()
      // Step 2: Upload to R2
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: await (await fetch(asset.uri)).blob(),
      })
      // Step 3: Update user profile
      const { user: updated } = await userAPI.updateMe({ avatar_url: publicUrl })
      updateUser(updated)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Upload failed', 'Could not upload photo. Please try again.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleSaveName = async () => {
    if (!nameValue.trim()) return
    setSavingName(true)
    try {
      const { user: updated } = await userAPI.updateMe({ name: nameValue.trim() })
      updateUser(updated)
      setEditingName(false)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Save failed', 'Could not update your name. Please try again.')
    } finally {
      setSavingName(false)
    }
  }

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of Gravity?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await stopBackgroundTracking()
          await logout()
        },
      },
    ])
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'
  const accountType = user?.role === 'child' ? 'Child' : 'Parent'
  const isFreePlan = !subscription || subscription.plan_id === 'free' || subscription.plan_id == null

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}>

        {/* ── Avatar section ── */}
        <Animated.View style={[styles.avatarSection, { opacity: fadeAnim }]}>
          <Pressable onPress={handlePickAvatar} style={styles.avatarWrapper} disabled={uploadingAvatar}>
            <Animated.View style={{ transform: [{ scale: avatarScale }] }}>
              {user?.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={Gradients.button} style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </LinearGradient>
              )}
              <LinearGradient colors={Gradients.buttonHero} style={styles.avatarEditBadge}>
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="camera" size={14} color="#fff" />
                }
              </LinearGradient>
            </Animated.View>
          </Pressable>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userPhone}>{user?.phone}</Text>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Location sharing active</Text>
          </View>
        </Animated.View>

        {/* Upload overlay */}
        {uploadingAvatar && (
          <View style={styles.uploadOverlay}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.uploadOverlayText}>Uploading photo...</Text>
          </View>
        )}

        <Animated.View style={[styles.sections, { opacity: fadeAnim }]}>

          {/* ── Profile info card ── */}
          <GradientCard style={styles.section}>
            <Text style={styles.sectionTitle}>Profile</Text>

            {/* Name row */}
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="person-outline" size={18} color={Colors.accentSoft} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Name</Text>
                {editingName ? (
                  <TextInput
                    style={styles.nameInput}
                    value={nameValue}
                    onChangeText={setNameValue}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSaveName}
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.infoValue}>{user?.name || '—'}</Text>
                )}
              </View>
              {editingName ? (
                <View style={styles.editActions}>
                  <Pressable onPress={() => { setEditingName(false); setNameValue(user?.name || '') }} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleSaveName} style={styles.saveBtn} disabled={savingName}>
                    {savingName
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.saveBtnText}>Save</Text>
                    }
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => { setEditingName(true); if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) }}>
                  <Ionicons name="pencil-outline" size={18} color={Colors.accentSoft} />
                </Pressable>
              )}
            </View>

            {/* Email row */}
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="mail-outline" size={18} color={Colors.accentSoft} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{user?.email || '—'}</Text>
              </View>
            </View>

            {/* Phone row */}
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="call-outline" size={18} color={Colors.accentSoft} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{user?.phone || '—'}</Text>
              </View>
            </View>

            {/* Account type badge */}
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="shield-outline" size={18} color={Colors.accentSoft} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Account Type</Text>
                <View style={styles.accountBadge}>
                  <Text style={styles.accountBadgeText}>{accountType}</Text>
                </View>
              </View>
            </View>
          </GradientCard>

          {/* ── Subscription card ── */}
          <GradientCard style={styles.section}>
            <Text style={styles.sectionTitle}>Subscription</Text>
            {loadingSub ? (
              <ActivityIndicator size="small" color={Colors.accent} style={{ marginVertical: 12 }} />
            ) : subscription ? (
              <>
                <View style={styles.subHeader}>
                  <View>
                    <Text style={styles.planName}>{subscription.display_name || 'Free Plan'}</Text>
                    <View style={[styles.subStatusBadge, { backgroundColor: subscription.status === 'active' ? 'rgba(0,230,118,0.15)' : 'rgba(229,57,53,0.15)' }]}>
                      <Text style={[styles.subStatusText, { color: subscription.status === 'active' ? Colors.online : Colors.danger }]}>
                        {subscription.status === 'active' ? 'Active' : subscription.status || 'Inactive'}
                      </Text>
                    </View>
                  </View>
                  {isFreePlan && (
                    <Pressable
                      style={styles.upgradeBtn}
                      onPress={() => Alert.alert('Coming Soon', 'Plan upgrades will be available soon!')}>
                      <Text style={styles.upgradeBtnText}>Upgrade</Text>
                    </Pressable>
                  )}
                </View>
                {Array.isArray(subscription.features) && subscription.features.length > 0 && (
                  <View style={styles.featuresList}>
                    {subscription.features.map((f, i) => (
                      <View key={i} style={styles.featureRow}>
                        <Ionicons name="checkmark-circle" size={15} color={Colors.online} />
                        <Text style={styles.featureText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.subFallback}>
                <Text style={styles.planName}>Free Plan</Text>
                <Pressable
                  style={styles.upgradeBtn}
                  onPress={() => Alert.alert('Coming Soon', 'Plan upgrades will be available soon!')}>
                  <Text style={styles.upgradeBtnText}>Upgrade Plan</Text>
                </Pressable>
              </View>
            )}
          </GradientCard>

          {/* ── Settings toggles ── */}
          <GradientCard style={styles.section}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <SettingRow
              icon="location"
              label="Location Tracking"
              value={trackingEnabled}
              onToggle={async (v) => {
                setTrackingEnabled(v)
                if (!v) await stopBackgroundTracking()
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              }}
              toggle
            />
            <SettingRow
              icon="notifications"
              label="Push Notifications"
              value={notificationsEnabled}
              onToggle={(v) => {
                setNotificationsEnabled(v)
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              }}
              toggle
            />
          </GradientCard>

          {/* ── Sign Out ── */}
          <Pressable style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </Pressable>

          <Text style={styles.version}>Gravity v1.0.0 by Trackalways</Text>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

function SettingRow({ icon, label, value, onToggle, toggle, chevron, onPress }) {
  return (
    <Pressable style={styles.settingRow} onPress={onPress}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={20} color={Colors.accentSoft} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      {toggle && (
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: Colors.bgMid, true: Colors.accentSoft }}
          thumbColor={value ? Colors.accent : Colors.textMuted}
        />
      )}
      {chevron && <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  scroll: { paddingHorizontal: 20, gap: 20 },

  // Avatar
  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatarWrapper: { marginBottom: 4 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.accent },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: Colors.accent },
  avatarInitials: { fontSize: 36, fontWeight: '800', color: Colors.textWhite },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.bgDark },
  userName: { fontSize: 24, fontWeight: '800', color: Colors.textWhite },
  userPhone: { fontSize: 15, color: Colors.textMuted },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.bgGlassStrong, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.online },
  statusText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },

  // Upload overlay
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 99, gap: 12 },
  uploadOverlayText: { color: Colors.textWhite, fontSize: 15, fontWeight: '600' },

  // Sections
  sections: { gap: 14 },
  section: { padding: 20, gap: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },

  // Profile info rows
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  infoIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgGlass, alignItems: 'center', justifyContent: 'center' },
  infoContent: { flex: 1, gap: 2 },
  infoLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },
  nameInput: { fontSize: 15, color: Colors.textWhite, fontWeight: '500', borderBottomWidth: 1, borderBottomColor: Colors.accent, paddingVertical: 2 },
  editActions: { flexDirection: 'row', gap: 8 },
  cancelBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.bgGlass },
  cancelBtnText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  saveBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.accent },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  accountBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,230,118,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)' },
  accountBadgeText: { color: Colors.online, fontSize: 12, fontWeight: '700' },

  // Subscription
  subHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  planName: { fontSize: 17, fontWeight: '700', color: Colors.textWhite, marginBottom: 4 },
  subStatusBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  subStatusText: { fontSize: 12, fontWeight: '700' },
  upgradeBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  upgradeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  featuresList: { gap: 6, marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { color: Colors.textSecondary, fontSize: 14 },
  subFallback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },

  // Settings
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 14 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgGlass, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },

  // Sign out
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(229,57,53,0.25)' },
  logoutText: { color: Colors.danger, fontSize: 16, fontWeight: '700' },
  version: { textAlign: 'center', color: Colors.textMuted, fontSize: 12, paddingBottom: 8 },
})
