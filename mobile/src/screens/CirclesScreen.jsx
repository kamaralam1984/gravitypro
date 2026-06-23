import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Animated, Pressable,
  TextInput, Modal, ActivityIndicator, Alert, Platform, FlatList, RefreshControl,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import { circleAPI } from '../services/api'
import { useCircleStore } from '../store/circleStore'
import { Colors, Gradients } from '../theme/colors'
import { GradientCard } from '../components/ui/GradientCard'
import { PremiumButton } from '../components/ui/PremiumButton'
import { MemberAvatar } from '../components/MemberAvatar'

// ─── Toast ──────────────────────────────────────────────────────────────────

function Toast({ message, visible }) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start()
    }
  }, [visible, message])

  if (!message) return null
  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  )
}

// ─── Member Row ──────────────────────────────────────────────────────────────

function relativeTime(ts) {
  if (!ts) return null
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function MemberRow({ member, isAdmin, onRemove }) {
  const navigation = useNavigation()
  // Badge reflects the USER's account type (Parent/Child), not the circle role.
  const isParent = (member.account_type || (member.role === 'admin' ? 'parent' : 'child')) === 'parent'
  const roleLabel = isParent ? 'Parent' : 'Child'
  const roleColor = isParent ? Colors.accent : Colors.accentSoft
  const lastSeen = member.location_updated_at
  const isOnline = lastSeen ? (Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000) : false
  const battery = member.battery_level
  // Tapping a child opens the parental-controls hub (timeline / screen-time / blocking).
  const openHub = isParent ? undefined : () => navigation.navigate('ChildHub', { member })

  return (
    <Pressable onPress={openHub} style={({ pressed }) => [styles.memberRow, pressed && openHub && { opacity: 0.7 }]}>
      <MemberAvatar member={member} size={40} showStatus isOnline={isOnline} />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{member.name}</Text>
        <View style={styles.memberMetaRow}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.accent : Colors.textMuted }]} />
          <Text style={styles.memberMeta} numberOfLines={1}>
            {isOnline ? 'Online' : (lastSeen ? `Last seen ${relativeTime(lastSeen)}` : 'No location yet')}
            {battery != null ? `  ·  🔋 ${battery}%` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.memberRight}>
        <View style={[styles.roleBadge, { borderColor: roleColor }]}>
          <Text style={[styles.roleText, { color: roleColor }]}>{roleLabel}</Text>
        </View>
        {isAdmin && !isParent && (
          <Pressable onPress={() => onRemove(member)} style={styles.removeBtn} hitSlop={8}>
            <Ionicons name="person-remove-outline" size={16} color={Colors.danger} />
          </Pressable>
        )}
        {!isParent && <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />}
      </View>
    </Pressable>
  )
}

// ─── Circle Card ─────────────────────────────────────────────────────────────

function CircleCard({ circle, index, onCopy, onToast, onLeft, onRenamed }) {
  const slideAnim = useRef(new Animated.Value(40)).current
  const fadeAnim = useRef(new Animated.Value(0)).current
  const expandAnim = useRef(new Animated.Value(0)).current
  const [expanded, setExpanded] = useState(false)
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(circle.name)
  const [savingName, setSavingName] = useState(false)
  // The current user's role in THIS circle is returned by GET /circles (cm.role).
  const isAdminOfCircle = circle.role === 'admin'

  const handleRename = async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === circle.name) { setRenaming(false); return }
    setSavingName(true)
    try {
      await circleAPI.update(circle.id, { name: trimmed })
      onRenamed && onRenamed(circle.id, trimmed)
      setRenaming(false)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      onToast('Circle renamed')
    } catch (e) {
      Alert.alert('Error', e.error || 'Failed to rename circle')
    } finally {
      setSavingName(false)
    }
  }

  useEffect(() => {
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, index * 80)
  }, [])

  const toggleExpand = async () => {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    Animated.timing(expandAnim, {
      toValue: nextExpanded ? 1 : 0,
      duration: 280,
      useNativeDriver: false,
    }).start()

    if (nextExpanded && members.length === 0) {
      setLoadingMembers(true)
      try {
        const res = await circleAPI.getMembers(circle.id)
        setMembers(res.members || [])
      } catch (e) {
        console.error('Failed to load members', e)
      } finally {
        setLoadingMembers(false)
      }
    }
  }

  const handleRemoveMember = (member) => {
    Alert.alert(
      'Remove Member',
      `Remove ${member.name} from this circle?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            try {
              await circleAPI.removeMember(circle.id, member.id)
              setMembers(prev => prev.filter(m => m.id !== member.id))
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
            } catch (e) {
              Alert.alert('Error', 'Failed to remove member')
            }
          },
        },
      ]
    )
  }

  const handleLeave = () => {
    Alert.alert(
      'Leave Circle',
      `Are you sure you want to leave "${circle.name}"? You'll stop sharing your location with this group.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: async () => {
            try {
              await circleAPI.leave(circle.id)
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
              onToast('Left circle')
              onLeft && onLeft(circle.id)
            } catch (e) {
              Alert.alert('Error', e.error || 'Failed to leave circle')
            }
          },
        },
      ]
    )
  }

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(circle.invite_code)
    } catch {
      Clipboard.setString(circle.invite_code)
    }
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onToast('Copied!')
  }

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 14 }}>
      <GradientCard style={styles.circleCard}>
        {/* Card header — tap to expand */}
        <Pressable onPress={toggleExpand} style={styles.circleCardHeader}>
          <LinearGradient colors={Gradients.button} style={styles.circleIconBg}>
            <Ionicons name="shield-checkmark" size={22} color={Colors.accent} />
          </LinearGradient>

          <View style={styles.circleInfo}>
            {renaming ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.renameInput}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleRename}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={40}
                />
                <Pressable onPress={handleRename} style={styles.renameSaveBtn} hitSlop={8} disabled={savingName}>
                  {savingName
                    ? <ActivityIndicator size="small" color={Colors.accent} />
                    : <Ionicons name="checkmark" size={18} color={Colors.accent} />}
                </Pressable>
                <Pressable onPress={() => { setRenaming(false); setNameDraft(circle.name) }} style={styles.renameSaveBtn} hitSlop={8}>
                  <Ionicons name="close" size={18} color={Colors.textMuted} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.circleName}>{circle.name}</Text>
                {isAdminOfCircle && (
                  <Pressable
                    onPress={(e) => { e.stopPropagation?.(); setNameDraft(circle.name); setRenaming(true) }}
                    hitSlop={8}
                    style={styles.renamePencil}>
                    <Ionicons name="pencil-outline" size={14} color={Colors.accentSoft} />
                  </Pressable>
                )}
              </View>
            )}
            <View style={styles.inviteChipRow}>
              <Text style={styles.inviteChip}>{circle.invite_code}</Text>
            </View>
          </View>

          <View style={styles.circleRight}>
            <View style={styles.memberCountWrap}>
              <Text style={styles.memberCountNum}>{circle.member_count || 0}</Text>
              <Text style={styles.memberCountLabel}>members</Text>
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={Colors.textMuted}
              style={{ marginTop: 6 }}
            />
          </View>
        </Pressable>

        {/* Copy code row */}
        <View style={styles.copyRow}>
          <View style={styles.codeBlock}>
            <Ionicons name="key-outline" size={14} color={Colors.accentSoft} />
            <Text style={styles.codeText}>{circle.invite_code}</Text>
          </View>
          <Pressable onPress={handleCopy} style={styles.copyBtn}>
            <Ionicons name="copy-outline" size={15} color={Colors.accent} />
            <Text style={styles.copyBtnText}>Copy Invite Code</Text>
          </Pressable>
        </View>

        {/* Expandable member list */}
        {expanded && (
          <View style={styles.memberList}>
            <View style={styles.divider} />
            {loadingMembers ? (
              <ActivityIndicator size="small" color={Colors.accent} style={{ marginVertical: 16 }} />
            ) : members.length === 0 ? (
              <Text style={styles.noMembersText}>No members found</Text>
            ) : (
              members.map(m => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isAdmin={isAdminOfCircle}
                  onRemove={handleRemoveMember}
                />
              ))
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.circleFooter}>
          <Ionicons name="shield-checkmark" size={13} color={Colors.accentSoft} />
          <Text style={styles.circleStatus}>Active · Location sharing on</Text>
          <Pressable onPress={handleLeave} style={styles.leaveBtn} hitSlop={8}>
            <Ionicons name="exit-outline" size={14} color={Colors.danger} />
            <Text style={styles.leaveBtnText}>Leave circle</Text>
          </Pressable>
        </View>
      </GradientCard>
    </Animated.View>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CirclesScreen() {
  const insets = useSafeAreaInsets()
  const removeCircleFromStore = useCircleStore(s => s.removeCircle)
  const setStoreCircles = useCircleStore(s => s.setCircles)
  const [circles, setCircles] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showFABSheet, setShowFABSheet] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [circleName, setCircleName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [toastKey, setToastKey] = useState(0)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(30)).current
  const fabSheetAnim = useRef(new Animated.Value(200)).current

  useEffect(() => {
    loadCircles()
  }, [])

  const loadCircles = async () => {
    setLoading(true)
    try {
      const res = await circleAPI.getMy()
      setCircles(res.circles || [])
      setStoreCircles(res.circles || [])
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

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await circleAPI.getMy()
      setCircles(res.circles || [])
      setStoreCircles(res.circles || [])
    } catch (e) {
      console.error('Refresh circles failed', e)
    } finally {
      setRefreshing(false)
    }
  }

  const showToast = (msg) => {
    setToast(msg)
    setToastKey(k => k + 1)
  }

  const handleLeftCircle = (circleId) => {
    setCircles(prev => prev.filter(c => c.id !== circleId))
    removeCircleFromStore(circleId)
  }

  const handleRenamedCircle = (circleId, name) => {
    setCircles(prev => prev.map(c => (c.id === circleId ? { ...c, name } : c)))
  }

  const openFABSheet = () => {
    setShowFABSheet(true)
    Animated.spring(fabSheetAnim, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true }).start()
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const closeFABSheet = () => {
    Animated.timing(fabSheetAnim, { toValue: 200, duration: 220, useNativeDriver: true }).start(() => {
      setShowFABSheet(false)
    })
  }

  const openCreate = () => {
    closeFABSheet()
    setTimeout(() => {
      setError('')
      setCircleName('')
      setShowCreateModal(true)
    }, 230)
  }

  const openJoin = () => {
    closeFABSheet()
    setTimeout(() => {
      setError('')
      setInviteCode('')
      setShowJoinModal(true)
    }, 230)
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
      showToast('Circle created!')
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
      showToast('Joined circle!')
      await loadCircles()
    } catch (e) {
      setError(e.error || 'Invalid invite code')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <LinearGradient
        colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.88)']}
        style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTextBlock}>
          <Text style={styles.headerTitle}>My Circles</Text>
          <Text style={styles.headerSubtitle}>
            {circles.length > 0 ? `${circles.length} family group${circles.length !== 1 ? 's' : ''}` : 'Create or join a group'}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="people" size={16} color={Colors.accent} />
          <Text style={styles.headerBadgeText}>{circles.length}</Text>
        </View>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} colors={[Colors.accent]} />
        }>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.loadingText}>Loading circles…</Text>
          </View>
        ) : circles.length === 0 ? (
          <EmptyState onCreatePress={openCreate} onJoinPress={openJoin} />
        ) : (
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            {circles.map((circle, index) => (
              <CircleCard
                key={circle.id}
                circle={circle}
                index={index}
                onToast={showToast}
                onLeft={handleLeftCircle}
                onRenamed={handleRenamedCircle}
              />
            ))}
          </Animated.View>
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={openFABSheet}
        style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <LinearGradient colors={Gradients.buttonHero} style={styles.fabGrad}>
          <Ionicons name="add" size={28} color="#fff" />
        </LinearGradient>
      </Pressable>

      {/* Toast */}
      <Toast key={toastKey} message={toast} visible={!!toast} />

      {/* FAB Bottom Sheet */}
      <Modal visible={showFABSheet} transparent animationType="none" onRequestClose={closeFABSheet}>
        <Pressable style={styles.sheetOverlay} onPress={closeFABSheet}>
          <BlurView intensity={25} style={StyleSheet.absoluteFill} />
        </Pressable>
        <View style={[styles.sheetWrapper, { paddingBottom: insets.bottom + 16 }]}>
          <Animated.View style={{ transform: [{ translateY: fabSheetAnim }] }}>
            <GradientCard style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Add a Circle</Text>
              <Text style={styles.sheetSubtitle}>Create a new group or join an existing one</Text>

              <Pressable onPress={openCreate} style={styles.sheetOption}>
                <LinearGradient colors={Gradients.button} style={styles.sheetOptionIcon}>
                  <Ionicons name="add-circle" size={22} color={Colors.accent} />
                </LinearGradient>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionTitle}>Create Circle</Text>
                  <Text style={styles.sheetOptionDesc}>Start a new family group</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </Pressable>

              <View style={styles.sheetDivider} />

              <Pressable onPress={openJoin} style={styles.sheetOption}>
                <LinearGradient colors={['#0A5C35', '#063D22']} style={styles.sheetOptionIcon}>
                  <Ionicons name="enter-outline" size={22} color={Colors.accentSoft} />
                </LinearGradient>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionTitle}>Join with Code</Text>
                  <Text style={styles.sheetOptionDesc}>Enter an invite code to join</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </Pressable>
            </GradientCard>
          </Animated.View>
        </View>
      </Modal>

      {/* Create Circle Modal */}
      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <BlurView intensity={30} style={StyleSheet.absoluteFill} />
        <View style={[styles.centeredOverlay, { paddingBottom: insets.bottom }]}>
          <GradientCard style={styles.modal}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <LinearGradient colors={Gradients.button} style={styles.modalIconBg}>
                <Ionicons name="people" size={20} color={Colors.accent} />
              </LinearGradient>
              <View>
                <Text style={styles.modalTitle}>Create a Circle</Text>
                <Text style={styles.modalSubtitle}>Name your family group</Text>
              </View>
            </View>

            <View style={styles.modalInput}>
              <Ionicons name="people-outline" size={20} color={Colors.accentSoft} />
              <TextInput
                style={styles.modalTextInput}
                value={circleName}
                onChangeText={setCircleName}
                placeholder="e.g. Smith Family"
                placeholderTextColor={Colors.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreateCircle}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <PremiumButton
                title="Create"
                onPress={handleCreateCircle}
                loading={actionLoading}
                style={{ flex: 1 }}
              />
            </View>
          </GradientCard>
        </View>
      </Modal>

      {/* Join Circle Modal */}
      <Modal visible={showJoinModal} transparent animationType="slide" onRequestClose={() => setShowJoinModal(false)}>
        <BlurView intensity={30} style={StyleSheet.absoluteFill} />
        <View style={[styles.centeredOverlay, { paddingBottom: insets.bottom }]}>
          <GradientCard style={styles.modal}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <LinearGradient colors={['#0A5C35', '#063D22']} style={styles.modalIconBg}>
                <Ionicons name="key-outline" size={20} color={Colors.accentSoft} />
              </LinearGradient>
              <View>
                <Text style={styles.modalTitle}>Join a Circle</Text>
                <Text style={styles.modalSubtitle}>Enter your family invite code</Text>
              </View>
            </View>

            <View style={styles.modalInput}>
              <Ionicons name="key-outline" size={20} color={Colors.accentSoft} />
              <TextInput
                style={[styles.modalTextInput, styles.monoInput]}
                value={inviteCode}
                onChangeText={t => setInviteCode(t.toUpperCase())}
                placeholder="XXXXXXXXXXXXXXXX"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleJoinCircle}
                maxLength={20}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setShowJoinModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <PremiumButton
                title="Join"
                onPress={handleJoinCircle}
                loading={actionLoading}
                style={{ flex: 1 }}
              />
            </View>
          </GradientCard>
        </View>
      </Modal>
    </View>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onCreatePress, onJoinPress }) {
  const floatAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -8, duration: 1800, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start()
  }, [])

  return (
    <View style={styles.emptyBox}>
      <Animated.View style={[styles.emptyIllustration, { transform: [{ translateY: floatAnim }] }]}>
        <LinearGradient colors={['rgba(0,200,83,0.2)', 'rgba(10,92,53,0.1)']} style={styles.emptyIconRing}>
          <LinearGradient colors={Gradients.button} style={styles.emptyIconBg}>
            <Ionicons name="people" size={44} color={Colors.accent} />
          </LinearGradient>
        </LinearGradient>
      </Animated.View>

      <Text style={styles.emptyTitle}>Create your family circle</Text>
      <Text style={styles.emptyText}>
        Connect with your family and friends.{'\n'}Share locations, stay safe together.
      </Text>

      <View style={styles.emptyActions}>
        <PremiumButton
          title="Create Circle"
          onPress={onCreatePress}
          icon={<Ionicons name="add-circle" size={18} color="#fff" />}
          style={{ flex: 1 }}
        />
        <Pressable onPress={onJoinPress} style={styles.emptyJoinBtn}>
          <Ionicons name="enter-outline" size={18} color={Colors.accent} />
          <Text style={styles.emptyJoinText}>Join with Code</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerTextBlock: { flex: 1 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: Colors.textWhite },
  headerSubtitle: { fontSize: 14, color: Colors.textMuted, marginTop: 2 },
  headerBadge: {
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
  headerBadgeText: { color: Colors.accent, fontWeight: '700', fontSize: 14 },

  // Scroll
  scrollArea: { flex: 1 },
  scroll: { padding: 20 },
  loadingBox: { paddingVertical: 80, alignItems: 'center', gap: 14 },
  loadingText: { color: Colors.textMuted, fontSize: 14 },

  // Circle Card
  circleCard: { padding: 18, gap: 2 },
  circleCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  circleIconBg: {
    width: 50, height: 50, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  circleInfo: { flex: 1, gap: 4 },
  circleName: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  renamePencil: { padding: 2 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  renameInput: { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.textWhite, borderBottomWidth: 1, borderBottomColor: Colors.accent, paddingVertical: 2 },
  renameSaveBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgGlass },
  inviteChipRow: { flexDirection: 'row' },
  inviteChip: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    color: Colors.accentSoft,
    backgroundColor: Colors.bgGlass,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    letterSpacing: 1.2,
  },
  circleRight: { alignItems: 'center', gap: 2 },
  memberCountWrap: { alignItems: 'center' },
  memberCountNum: { fontSize: 22, fontWeight: '800', color: Colors.accent },
  memberCountLabel: { fontSize: 11, color: Colors.textMuted },

  // Copy row
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    backgroundColor: Colors.bgMid,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  codeBlock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeText: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  copyBtnText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },

  // Member list
  divider: { height: 1, backgroundColor: Colors.divider, marginVertical: 14 },
  memberList: { gap: 0 },
  noMembersText: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  memberJoined: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  memberMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  memberMeta: { fontSize: 11, color: Colors.textMuted, flexShrink: 1 },
  memberRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  roleText: { fontSize: 11, fontWeight: '700' },
  removeBtn: {
    padding: 6,
    backgroundColor: 'rgba(229,57,53,0.1)',
    borderRadius: 8,
  },

  // Circle footer
  circleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  circleStatus: { fontSize: 12, color: Colors.textMuted, flex: 1 },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(229,57,53,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  leaveBtnText: { color: Colors.danger, fontSize: 12, fontWeight: '700' },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    borderRadius: 28,
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 14,
  },
  fabGrad: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },

  // Toast
  toast: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.bgCard,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },

  // FAB Bottom Sheet
  sheetOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    zIndex: 1,
  },
  sheet: {
    padding: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 4,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  sheetSubtitle: { fontSize: 13, color: Colors.textMuted, marginBottom: 8 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  sheetOptionIcon: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  sheetOptionText: { flex: 1 },
  sheetOptionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  sheetOptionDesc: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  sheetDivider: { height: 1, backgroundColor: Colors.divider, marginVertical: 2 },

  // Modal shared
  centeredOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  modal: {
    width: '100%',
    padding: 24,
    gap: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  modalIconBg: {
    width: 44, height: 44, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 19, fontWeight: '800', color: Colors.textPrimary },
  modalSubtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 1 },
  modalInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.bgMid,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTextInput: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  monoInput: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }),
    letterSpacing: 2,
    fontSize: 15,
  },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(229,57,53,0.1)',
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: Colors.danger, fontSize: 13, flex: 1 },
  modalActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 16 },
  modalCancelText: { color: Colors.textMuted, fontSize: 15, fontWeight: '600' },

  // Empty state
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
    gap: 16,
  },
  emptyIllustration: { marginBottom: 8 },
  emptyIconRing: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyIconBg: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.borderStrong,
  },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: Colors.textSecondary, textAlign: 'center' },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 22 },
  emptyActions: { width: '100%', gap: 12, marginTop: 8 },
  emptyJoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.bgCard,
  },
  emptyJoinText: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
})
