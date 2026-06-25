import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, Alert, Modal, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '../theme/ThemeContext'
import { familyAPI } from '../services/familyApi'

export default function EmergencyContactsScreen() {
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const colors = useTheme()
  const s = makeStyles(colors)

  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [relation, setRelation] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await familyAPI.getContacts()
      setContacts(res.contacts || [])
    } catch (e) {
      Alert.alert('Error', 'Could not load emergency contacts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Enter a contact name.')
    setSaving(true)
    try {
      const body = { name: name.trim() }
      if (phone.trim()) body.phone = phone.trim()
      if (relation.trim()) body.relation = relation.trim()
      await familyAPI.addContact(body)
      setName(''); setPhone(''); setRelation(''); setModal(false)
      load()
    } catch (e) {
      Alert.alert('Error', e?.error || 'Failed to add contact.')
    } finally {
      setSaving(false)
    }
  }

  const remove = (contact) => {
    Alert.alert('Delete contact', `Remove ${contact.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await familyAPI.deleteContact(contact.id); load() }
          catch (e) { Alert.alert('Error', 'Failed to delete contact.') }
        },
      },
    ])
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>Emergency Contacts</Text>
        <Pressable onPress={() => setModal(true)} hitSlop={10}>
          <Ionicons name="add" size={28} color={colors.primary || '#4f7cff'} />
        </Pressable>
      </View>

      <Text style={s.subtitle}>These people are also alerted when you raise an SOS.</Text>

      {loading ? (
        <ActivityIndicator color={colors.primary || '#4f7cff'} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {contacts.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
              <Text style={s.emptyText}>No emergency contacts yet.</Text>
              <Pressable style={s.emptyBtn} onPress={() => setModal(true)}>
                <Text style={s.emptyBtnText}>Add Contact</Text>
              </Pressable>
            </View>
          ) : contacts.map((c) => (
            <View key={c.id} style={s.card}>
              <View style={s.cardIcon}>
                <Ionicons name="person" size={20} color={colors.primary || '#4f7cff'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardName}>{c.name}</Text>
                <Text style={s.cardMeta}>
                  {[c.relation, c.phone].filter(Boolean).join('  •  ') || 'No details'}
                </Text>
              </View>
              <Pressable onPress={() => remove(c)} hitSlop={10} style={s.delBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.danger || '#ff5a5f'} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>New Emergency Contact</Text>

            <Text style={s.label}>Name</Text>
            <TextInput style={s.input} value={name} onChangeText={setName}
              placeholder="Full name" placeholderTextColor={colors.textSecondary} />

            <Text style={s.label}>Phone</Text>
            <TextInput style={s.input} value={phone} onChangeText={setPhone}
              placeholder="e.g. +91…" placeholderTextColor={colors.textSecondary} keyboardType="phone-pad" />

            <Text style={s.label}>Relation</Text>
            <TextInput style={s.input} value={relation} onChangeText={setRelation}
              placeholder="e.g. Mother, Doctor" placeholderTextColor={colors.textSecondary} />

            <View style={s.modalActions}>
              <Pressable style={[s.modalBtn, s.cancelBtn]} onPress={() => setModal(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.modalBtn, s.saveBtn, saving && { opacity: 0.6 }]} onPress={add} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep || c.bgDark || '#0b0f17' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  headerTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '700' },
  subtitle: { color: c.textSecondary, fontSize: 13, paddingHorizontal: 20, marginBottom: 8 },
  list: { padding: 16, paddingBottom: 60 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.bgCard || '#1a2030', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: c.border || '#2a3346' },
  cardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: (c.primary || '#4f7cff') + '22', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cardName: { color: c.textPrimary, fontSize: 16, fontWeight: '600' },
  cardMeta: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  delBtn: { padding: 6 },
  empty: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyText: { color: c.textSecondary, fontSize: 15 },
  emptyBtn: { marginTop: 8, backgroundColor: c.primary || '#4f7cff', paddingHorizontal: 22, paddingVertical: 11, borderRadius: 22 },
  emptyBtnText: { color: '#fff', fontWeight: '700' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modal: { backgroundColor: c.bgCard || '#1a2030', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 40 },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border || '#2a3346', marginBottom: 16 },
  modalTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  label: { color: c.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: c.bgDeep || c.bgDark || '#0b0f17', color: c.textPrimary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 16, borderWidth: 1, borderColor: c.border || '#2a3346' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtn: { backgroundColor: c.bgDeep || '#0b0f17', borderWidth: 1, borderColor: c.border || '#2a3346' },
  cancelText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { backgroundColor: c.primary || '#4f7cff' },
  saveText: { color: '#fff', fontWeight: '700' },
})
