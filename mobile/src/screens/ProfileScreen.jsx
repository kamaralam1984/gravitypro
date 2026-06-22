import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable, Animated,
  Switch, Image, Alert, Platform, TextInput, ActivityIndicator, Linking,
  Modal, FlatList,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { useAuthStore } from '../store/authStore'
import { mediaAPI, userAPI } from '../services/api'
import { stopBackgroundTracking } from '../services/location'
import { registerForPushNotifications } from '../services/notifications'
import { promptAndUpdate } from '../services/appUpdates'
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
  const [editingEmail, setEditingEmail] = useState(false)
  const [emailValue, setEmailValue] = useState(user?.email || '')
  const [savingEmail, setSavingEmail] = useState(false)

  // Settings toggles
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Location history
  const [historyVisible, setHistoryVisible] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyPoints, setHistoryPoints] = useState([])

  const openHistory = async () => {
    setHistoryVisible(true)
    setHistoryError('')
    setHistoryLoading(true)
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      const res = await userAPI.getLocationHistory()
      setHistoryPoints(res.history || res.locations || res.points || [])
    } catch (e) {
      setHistoryError('Could not load location history. Please try again.')
    } finally {
      setHistoryLoading(false)
    }
  }

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current
  const avatarScale = useRef(new Animated.Value(0.8)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(avatarScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start()
  }, [])

  // Keep nameValue/emailValue in sync if user updates externally
  useEffect(() => {
    if (!editingName) setNameValue(user?.name || '')
  }, [user?.name, editingName])

  useEffect(() => {
    if (!editingEmail) setEmailValue(user?.email || '')
  }, [user?.email, editingEmail])

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
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
      // Step 1: presign (backend returns { uploadUrl, key, publicUrl })
      const { uploadUrl, publicUrl } = await mediaAPI.presignAvatar({ contentType, fileSize: asset.fileSize })
      // Step 2: Upload to R2
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: await (await fetch(asset.uri)).blob(),
      })
      // Step 3: Confirm upload, then sync the profile
      await mediaAPI.confirmAvatar({ publicUrl })
      const { user: updated } = await userAPI.updateMe({ avatar_url: publicUrl })
      updateUser(updated)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      console.error('Avatar upload error:', e)
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

  const handleSaveEmail = async () => {
    if (!emailValue.trim()) return
    setSavingEmail(true)
    try {
      const { user: updated } = await userAPI.updateMe({ email: emailValue.trim() })
      updateUser(updated)
      setEditingEmail(false)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Save failed', 'Could not update your email. Please try again.')
    } finally {
      setSavingEmail(false)
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

  const [deletingAccount, setDeletingAccount] = useState(false)
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, location history, and remove you from all circles. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setDeletingAccount(true)
            try {
              await userAPI.deleteAccount()
              await stopBackgroundTracking()
              await logout()
            } catch (e) {
              setDeletingAccount(false)
              Alert.alert('Delete failed', 'Could not delete your account. Please try again.')
            }
          },
        },
      ]
    )
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'
  const accountType = user?.role === 'child' ? 'Child' : 'Parent'

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
                {editingEmail ? (
                  <TextInput
                    style={styles.nameInput}
                    value={emailValue}
                    onChangeText={setEmailValue}
                    autoFocus
                    keyboardType="email-address"
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleSaveEmail}
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.infoValue}>{user?.email || '—'}</Text>
                )}
              </View>
              {editingEmail ? (
                <View style={styles.editActions}>
                  <Pressable onPress={() => { setEditingEmail(false); setEmailValue(user?.email || '') }} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleSaveEmail} style={styles.saveBtn} disabled={savingEmail}>
                    {savingEmail
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.saveBtnText}>Save</Text>
                    }
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => { setEditingEmail(true); if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) }}>
                  <Ionicons name="pencil-outline" size={18} color={Colors.accentSoft} />
                </Pressable>
              )}
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
                      onPress={() => Linking.openURL('https://gravitypro.kvlbusinesssolutions.com/checkout?plan=family')}>
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
                  onPress={() => Linking.openURL('https://gravitypro.kvlbusinesssolutions.com/checkout?plan=family')}>
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
              onToggle={async (v) => {
                setNotificationsEnabled(v)
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                if (v) {
                  await registerForPushNotifications().catch(() => {})
                } else {
                  await userAPI.clearPushToken().catch(() => {})
                }
              }}
              toggle
            />
          </GradientCard>

          {/* ── Privacy ── */}
          <GradientCard style={styles.section}>
            <Text style={styles.sectionTitle}>Privacy</Text>
            <SettingRow
              icon="time-outline"
              label="Location History"
              chevron
              onPress={openHistory}
            />
          </GradientCard>

          {/* ── Check for Update ── */}
          <Pressable style={styles.updateBtn} onPress={promptAndUpdate}>
            <Ionicons name="cloud-download-outline" size={20} color={Colors.accent} />
            <Text style={styles.updateText}>Check for Update</Text>
          </Pressable>

          {/* ── Sign Out ── */}
          <Pressable style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </Pressable>

          {/* ── Delete Account ── */}
          <Pressable style={styles.deleteBtn} onPress={handleDeleteAccount} disabled={deletingAccount}>
            {deletingAccount
              ? <ActivityIndicator size="small" color={Colors.danger} />
              : <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            }
            <Text style={styles.deleteText}>Delete Account</Text>
          </Pressable>

          <Text style={styles.version}>Gravity v1.0.0 by Trackalways</Text>
        </Animated.View>
      </ScrollView>

      {/* ── Location History Modal ── */}
      <Modal
        visible={historyVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryVisible(false)}>
        <BlurView intensity={30} style={StyleSheet.absoluteFill} />
        <View style={[styles.historyOverlay, { paddingTop: insets.top + 60, paddingBottom: insets.bottom }]}>
          <GradientCard style={styles.historyCard}>
            <View style={styles.historyHandle} />
            <View style={styles.historyHeaderRow}>
              <View style={styles.historyTitleBlock}>
                <Text style={styles.historyTitle}>Location History</Text>
                <Text style={styles.historySubtitle}>Your recent recorded positions</Text>
              </View>
              <Pressable onPress={() => setHistoryVisible(false)} style={styles.historyCloseBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </Pressable>
            </View>

            {historyLoading ? (
              <View style={styles.historyCenter}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={styles.historyMutedText}>Loading history…</Text>
              </View>
            ) : historyError ? (
              <View style={styles.historyCenter}>
                <Ionicons name="alert-circle-outline" size={32} color={Colors.danger} />
                <Text style={styles.historyMutedText}>{historyError}</Text>
                <Pressable onPress={openHistory} style={styles.historyRetryBtn}>
                  <Text style={styles.historyRetryText}>Retry</Text>
                </Pressable>
              </View>
            ) : historyPoints.length === 0 ? (
              <View style={styles.historyCenter}>
                <Ionicons name="location-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.historyMutedText}>No location history yet.</Text>
              </View>
            ) : (
              <FlatList
                data={historyPoints}
                keyExtractor={(item, i) => String(item.id || item.recorded_at || item.created_at || i)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
                renderItem={({ item }) => {
                  const lat = item.latitude ?? item.lat
                  const lng = item.longitude ?? item.lng
                  const acc = item.accuracy ?? item.accuracy_meters
                  const ts = item.recorded_at || item.created_at || item.timestamp
                  return (
                    <View style={styles.historyRow}>
                      <View style={styles.historyDot}>
                        <Ionicons name="location" size={14} color={Colors.accent} />
                      </View>
                      <View style={styles.historyRowContent}>
                        <Text style={styles.historyCoords}>
                          {lat != null ? Number(lat).toFixed(5) : '—'}, {lng != null ? Number(lng).toFixed(5) : '—'}
                        </Text>
                        <Text style={styles.historyMeta}>
                          {ts ? new Date(ts).toLocaleString() : 'Unknown time'}
                          {acc != null ? ` · ±${Math.round(acc)}m` : ''}
                        </Text>
                      </View>
                    </View>
                  )
                }}
              />
            )}
          </GradientCard>
        </View>
      </Modal>
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
  updateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(10,92,53,0.15)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(10,92,53,0.4)', marginBottom: 10 },
  updateText: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(229,57,53,0.25)' },
  logoutText: { color: Colors.danger, fontSize: 16, fontWeight: '700' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 4 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600', opacity: 0.85 },
  version: { textAlign: 'center', color: Colors.textMuted, fontSize: 12, paddingBottom: 8 },

  // Location history modal
  historyOverlay: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 14 },
  historyCard: { padding: 20, gap: 12, maxHeight: '80%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  historyHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 2 },
  historyHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyTitleBlock: { flex: 1 },
  historyTitle: { fontSize: 19, fontWeight: '800', color: Colors.textPrimary },
  historySubtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  historyCloseBtn: { padding: 6, backgroundColor: Colors.bgMid, borderRadius: 10 },
  historyCenter: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, gap: 12 },
  historyMutedText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
  historyRetryBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.bgGlassStrong, borderWidth: 1, borderColor: Colors.border },
  historyRetryText: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  historyDot: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(0,200,83,0.12)', alignItems: 'center', justifyContent: 'center' },
  historyRowContent: { flex: 1, gap: 2 },
  historyCoords: { fontSize: 14, color: Colors.textPrimary, fontWeight: '700', fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }) },
  historyMeta: { fontSize: 12, color: Colors.textMuted },
})
