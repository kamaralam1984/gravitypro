import React, { useState, useRef, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Switch, Image, Alert, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { useAuthStore } from '../store/authStore'
import { mediaAPI } from '../services/api'
import { stopBackgroundTracking } from '../services/location'
import { GradientCard } from '../components/ui/GradientCard'
import { Colors, Gradients } from '../theme/colors'

export default function ProfileScreen() {
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
  const logout = useAuthStore(s => s.logout)
  const insets = useSafeAreaInsets()
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const avatarScale = useRef(new Animated.Value(0.8)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(avatarScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start()
  }, [])

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to update your profile picture.')
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
    setUploadingAvatar(true)
    try {
      const ext = asset.uri.split('.').pop()
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
      const { uploadUrl, publicUrl } = await mediaAPI.presignAvatar(contentType, asset.fileSize || 0)
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: await (await fetch(asset.uri)).blob(),
      })
      const { user: updated } = await mediaAPI.confirmAvatar(publicUrl)
      updateUser(updated)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Upload failed', 'Could not upload your photo. Please try again.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of Gravity?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await stopBackgroundTracking()
          await logout()
        }
      }
    ])
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}>

        {/* Avatar section */}
        <Animated.View style={[styles.avatarSection, { opacity: fadeAnim }]}>
          <Pressable onPress={handlePickAvatar} style={styles.avatarWrapper}>
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
                  ? <Ionicons name="reload" size={14} color="#fff" />
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

        {/* Settings sections */}
        <Animated.View style={[styles.sections, { opacity: fadeAnim }]}>
          {/* Privacy & Location */}
          <GradientCard style={styles.section}>
            <Text style={styles.sectionTitle}>Privacy & Location</Text>
            <SettingRow
              icon="location"
              label="Share My Location"
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
              onToggle={(v) => { setNotificationsEnabled(v); if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) }}
              toggle
            />
          </GradientCard>

          {/* Account */}
          <GradientCard style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <SettingRow icon="person-outline" label="Edit Profile" chevron onPress={() => {}} />
            <SettingRow icon="shield-outline" label="Privacy Policy" chevron onPress={() => {}} />
            <SettingRow icon="help-circle-outline" label="Help & Support" chevron onPress={() => {}} />
          </GradientCard>

          {/* Danger zone */}
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
  sections: { gap: 14 },
  section: { padding: 20, gap: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 14 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgGlass, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(229,57,53,0.25)' },
  logoutText: { color: Colors.danger, fontSize: 16, fontWeight: '700' },
  version: { textAlign: 'center', color: Colors.textMuted, fontSize: 12, paddingBottom: 8 },
})
