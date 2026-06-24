import React, { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, Alert, Image, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
import { useTheme } from '../theme/ThemeContext'
import { circleAPI, mediaAPI } from '../services/api'
import { familyAPI } from '../services/familyApi'

// Lightweight DOB entry (no native datetimepicker dependency in this project).
// Three numeric fields -> ISO YYYY-MM-DD. Validates a real calendar date.
function toISO(y, m, d) {
  if (!y || !m || !d) return null
  const yy = parseInt(y, 10), mm = parseInt(m, 10), dd = parseInt(d, 10)
  if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const dt = new Date(Date.UTC(yy, mm - 1, dd))
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null
  if (dt > new Date()) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${yy}-${pad(mm)}-${pad(dd)}`
}

export default function AddChildScreen() {
  const navigation = useNavigation()
  const route = useRoute()
  const insets = useSafeAreaInsets()
  const colors = useTheme()
  const s = makeStyles(colors)

  const [circles, setCircles] = useState([])
  const [circleId, setCircleId] = useState(route.params?.circleId || null)
  const [name, setName] = useState('')
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [avatarBase64, setAvatarBase64] = useState(null)
  const [avatarType, setAvatarType] = useState('image/jpeg')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await circleAPI.getMy()
        const list = res.circles || []
        // Only circles where the parent is admin can receive a new child.
        const adminCircles = list.filter((c) => c.role === 'admin')
        setCircles(adminCircles)
        if (!circleId && adminCircles.length) setCircleId(adminCircles[0].id)
      } catch (e) {
        Alert.alert('Error', 'Could not load your circles.')
      }
    })()
  }, [])

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) return Alert.alert('Permission needed', 'Allow photo access to set a picture.')
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true, aspect: [1, 1], quality: 0.6, base64: true,
      })
      if (!r.canceled && r.assets?.[0]?.uri) {
        const a = r.assets[0]
        setAvatarUrl(a.uri)
        setAvatarBase64(a.base64 || null)
        const ext = (a.uri.split('.').pop() || 'jpg').toLowerCase()
        setAvatarType(ext === 'png' ? 'image/png' : 'image/jpeg')
      }
    } catch (e) {
      Alert.alert('Error', 'Could not pick an image.')
    }
  }

  // Upload a local photo (file:// URI) using the same presign → PUT → confirm
  // sequence as ProfileScreen. Returns the public URL, or null on failure so
  // the caller can still create the child without a photo.
  const uploadAvatar = async () => {
    if (!avatarBase64) return null
    setUploading(true)
    try {
      // Upload base64 to the backend local-disk store (no R2). Returns { url }.
      const { url } = await mediaAPI.uploadImage({ dataBase64: avatarBase64, contentType: avatarType })
      return url
    } catch (e) {
      console.error('Child avatar upload error:', e)
      Alert.alert(
        'Photo upload failed',
        "Couldn't upload the photo. The child profile will be created without it.",
      )
      return null
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!circleId) return Alert.alert('Pick a circle', 'Choose which family circle this child belongs to.')
    if (!name.trim()) return Alert.alert('Name required', "Enter the child's name.")
    const dob = (year || month || day) ? toISO(year, month, day) : null
    if ((year || month || day) && !dob) return Alert.alert('Invalid date', 'Enter a valid date of birth.')

    setSaving(true)
    try {
      const body = { circle_id: circleId, name: name.trim() }
      if (dob) body.dob = dob
      if (phone.trim()) body.phone = phone.trim()

      // Resolve the child's avatar_url. If the parent picked a local photo
      // (a file:// URI), upload it via the same presign → PUT → confirm flow
      // ProfileScreen uses, and send the resulting public URL. Already-remote
      // http(s) URLs are passed through as-is. On upload failure we fall back
      // to creating the child without a photo (toast below) rather than blocking.
      if (avatarUrl && /^https?:\/\//.test(avatarUrl)) {
        body.avatar_url = avatarUrl
      } else if (avatarBase64) {
        const publicUrl = await uploadAvatar()
        if (publicUrl) body.avatar_url = publicUrl
      }

      await familyAPI.createChild(body)
      Alert.alert('Added', `${name.trim()} was added to the circle.`)
      navigation.goBack()
    } catch (e) {
      Alert.alert('Error', e?.error || 'Failed to create child profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>Add Child</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Pressable style={s.avatarWrap} onPress={pickPhoto} disabled={saving || uploading}>
          {uploading
            ? <ActivityIndicator color={colors.textSecondary} />
            : avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={s.avatar} />
              : <Ionicons name="camera" size={30} color={colors.textSecondary} />}
          <Text style={s.avatarHint}>
            {uploading ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Add photo'}
          </Text>
        </Pressable>

        <Text style={s.label}>Name</Text>
        <TextInput
          style={s.input} value={name} onChangeText={setName}
          placeholder="Child's name" placeholderTextColor={colors.textSecondary}
        />

        <Text style={s.label}>Date of birth (optional)</Text>
        <View style={s.dobRow}>
          <TextInput style={[s.input, s.dobCell]} value={day} onChangeText={setDay}
            placeholder="DD" placeholderTextColor={colors.textSecondary} keyboardType="number-pad" maxLength={2} />
          <TextInput style={[s.input, s.dobCell]} value={month} onChangeText={setMonth}
            placeholder="MM" placeholderTextColor={colors.textSecondary} keyboardType="number-pad" maxLength={2} />
          <TextInput style={[s.input, s.dobCellYear]} value={year} onChangeText={setYear}
            placeholder="YYYY" placeholderTextColor={colors.textSecondary} keyboardType="number-pad" maxLength={4} />
        </View>

        <Text style={s.label}>Phone (optional)</Text>
        <TextInput
          style={s.input} value={phone} onChangeText={setPhone}
          placeholder="e.g. +91…" placeholderTextColor={colors.textSecondary} keyboardType="phone-pad"
        />

        <Text style={s.label}>Circle</Text>
        {circles.length === 0 ? (
          <Text style={s.muted}>You are not an admin of any circle.</Text>
        ) : (
          <View style={s.circleRow}>
            {circles.map((c) => (
              <Pressable key={c.id} onPress={() => setCircleId(c.id)}
                style={[s.chip, circleId === c.id && s.chipActive]}>
                <Text style={[s.chipText, circleId === c.id && s.chipTextActive]}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable style={[s.saveBtn, (saving || uploading) && { opacity: 0.6 }]} onPress={save} disabled={saving || uploading}>
          {saving || uploading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.saveText}>Create Child Profile</Text>}
        </Pressable>
      </ScrollView>
    </View>
  )
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep || c.bgDark || '#0b0f17' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  headerTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 60 },
  avatarWrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', width: 110, height: 110, borderRadius: 55, backgroundColor: c.bgCard || '#1a2030', marginBottom: 24, borderWidth: 1, borderColor: c.border || '#2a3346' },
  avatar: { width: 110, height: 110, borderRadius: 55 },
  avatarHint: { color: c.textSecondary, fontSize: 12, marginTop: 6, position: 'absolute', bottom: -22 },
  label: { color: c.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  input: { backgroundColor: c.bgCard || '#1a2030', color: c.textPrimary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 16, borderWidth: 1, borderColor: c.border || '#2a3346' },
  dobRow: { flexDirection: 'row', gap: 10 },
  dobCell: { flex: 1, textAlign: 'center' },
  dobCellYear: { flex: 1.4, textAlign: 'center' },
  muted: { color: c.textSecondary, fontSize: 14, marginTop: 4 },
  circleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: c.bgCard || '#1a2030', borderWidth: 1, borderColor: c.border || '#2a3346' },
  chipActive: { backgroundColor: c.primary || '#4f7cff', borderColor: c.primary || '#4f7cff' },
  chipText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  saveBtn: { marginTop: 32, backgroundColor: c.primary || '#4f7cff', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
