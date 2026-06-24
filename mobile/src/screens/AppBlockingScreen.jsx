import React, { useCallback, useEffect, useState, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  Switch,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { parentalAPI } from '../services/api'
import { useTheme } from '../theme/ThemeContext'

// ── App row with toggle ───────────────────────────────────────────────────────

function AppToggleRow({ item, onToggle }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const label = item.app_label || item.package_name || 'Unknown app'
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, item.blocked && styles.rowIconBlocked]}>
        <Ionicons
          name={item.blocked ? 'lock-closed' : 'apps'}
          size={18}
          color={item.blocked ? c.danger : c.accent}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.package_name}
        </Text>
      </View>
      <Switch
        value={!!item.blocked}
        onValueChange={() => onToggle(item.package_name)}
        trackColor={{ false: c.bgGlass, true: c.accentDim }}
        thumbColor={item.blocked ? c.danger : c.textSecondary}
      />
    </View>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function AppBlockingScreen() {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const route = useRoute()
  const member = route.params?.member || {}
  const childId = member.id
  const childName = member.name || 'Child'

  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  const [newPkg, setNewPkg] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const load = useCallback(async () => {
    if (!childId) {
      setError('No child selected')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await parentalAPI.getBlockedApps(childId)
      const list = Array.isArray(res?.apps) ? res.apps : Array.isArray(res) ? res : []
      const norm = list
        .map((a) => ({
          package_name: String(a?.package_name ?? ''),
          app_label: String(a?.app_label ?? a?.package_name ?? ''),
          blocked: a?.blocked === true || a?.blocked === 1,
        }))
        .filter((a) => a.package_name)
      setApps(norm)
      setDirty(false)
    } catch (e) {
      setError(e?.message || 'Could not load apps')
      setApps([])
    } finally {
      setLoading(false)
    }
  }, [childId])

  useEffect(() => {
    load()
  }, [load])

  const toggle = useCallback((pkg) => {
    setApps((prev) =>
      prev.map((a) => (a.package_name === pkg ? { ...a, blocked: !a.blocked } : a))
    )
    setDirty(true)
  }, [])

  const addManual = useCallback(() => {
    const pkg = newPkg.trim()
    if (!pkg) {
      Alert.alert('Package required', 'Enter a package name (e.g. com.example.app).')
      return
    }
    if (apps.some((a) => a.package_name === pkg)) {
      Alert.alert('Already added', 'That package is already in the list.')
      return
    }
    setApps((prev) => [
      { package_name: pkg, app_label: newLabel.trim() || pkg, blocked: true },
      ...prev,
    ])
    setNewPkg('')
    setNewLabel('')
    setDirty(true)
  }, [newPkg, newLabel, apps])

  const save = useCallback(async () => {
    if (!childId) return
    setSaving(true)
    try {
      const payload = apps.map((a) => ({
        package_name: a.package_name,
        app_label: a.app_label,
        blocked: !!a.blocked,
      }))
      await parentalAPI.setBlockedApps(childId, payload)
      setDirty(false)
      Alert.alert('Saved', 'Blocked-app settings updated.')
    } catch (e) {
      Alert.alert('Save failed', e?.message || 'Could not save changes. Try again.')
    } finally {
      setSaving(false)
    }
  }, [childId, apps])

  const renderHeader = () => (
    <View style={styles.manualCard}>
      <Text style={styles.manualHint}>
        {apps.length === 0
          ? "No apps reported yet. The child device must report its installed apps first (requires the native build). For now you can add a package manually below."
          : 'Add a package manually if it is not in the list yet.'}
      </Text>
      <TextInput
        value={newPkg}
        onChangeText={setNewPkg}
        placeholder="Package name (com.example.app)"
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <TextInput
        value={newLabel}
        onChangeText={setNewLabel}
        placeholder="App label (optional)"
        placeholderTextColor={c.textMuted}
        style={styles.input}
      />
      <Pressable onPress={addManual} style={styles.addBtn}>
        <Ionicons name="add-circle-outline" size={18} color={c.accent} />
        <Text style={styles.addBtnText}>Add app</Text>
      </Pressable>
    </View>
  )

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={c.statusBarStyle} />

      {/* Header */}
      <LinearGradient colors={c.gradients.hero} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              App Blocking
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {childName}
            </Text>
          </View>
          <View style={styles.backBtn} />
        </View>
      </LinearGradient>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={c.warning} />
          <Text style={styles.emptyTitle}>Couldn't load apps</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={(it, i) => it.package_name || String(i)}
          renderItem={({ item }) => <AppToggleRow item={item} onToggle={toggle} />}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Save bar */}
      {!loading && !error && (
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            onPress={save}
            disabled={saving || !dirty}
            style={[styles.saveBtn, (saving || !dirty) && styles.saveBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator color={c.bgDeep} />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color={c.bgDeep} />
                <Text style={styles.saveText}>{dirty ? 'Save changes' : 'Saved'}</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDark },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '700' },
  headerSub: { color: c.textSecondary, fontSize: 13, marginTop: 1 },

  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 14 },
  emptyText: { color: c.textMuted, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  retryBtn: {
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: c.bgGlassStrong,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  retryText: { color: c.accent, fontWeight: '700' },

  manualCard: {
    backgroundColor: c.bgCard,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: c.border,
  },
  manualHint: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  input: {
    backgroundColor: c.bgSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    color: c.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14,
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: c.bgGlassStrong,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  addBtnText: { color: c.accent, fontWeight: '700', fontSize: 14 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgCard,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: c.bgGlass,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowIconBlocked: { backgroundColor: 'rgba(229,57,53,0.15)' },
  rowBody: { flex: 1, marginRight: 10 },
  rowLabel: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: c.textMuted, fontSize: 12, marginTop: 3 },

  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgDeep,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 25,
    backgroundColor: c.accent,
  },
  saveBtnDisabled: { backgroundColor: c.accentDim, opacity: 0.6 },
  saveText: { color: c.bgDeep, fontSize: 16, fontWeight: '800' },
})
