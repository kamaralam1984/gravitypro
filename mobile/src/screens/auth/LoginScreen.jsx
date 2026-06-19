import React, { useState, useRef } from 'react'
import { View, Text, TextInput, StyleSheet, ScrollView, Animated, KeyboardAvoidingView, Platform, Pressable } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { authAPI } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PremiumButton } from '../../components/ui/PremiumButton'
import { Colors, Gradients } from '../../theme/colors'

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const login = useAuthStore(s => s.login)
  const shakeAnim = useRef(new Animated.Value(0)).current

  const shake = () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start()
  }

  const handleLogin = async () => {
    if (!phone.trim() || !password) { setError('Phone and password required'); shake(); return }
    setLoading(true); setError('')
    try {
      const res = await authAPI.login({ phone: phone.trim(), password })
      await login(res.user, res.token)
    } catch (err) {
      setError(err.error || 'Login failed. Please check your credentials.')
      shake()
    } finally { setLoading(false) }
  }

  return (
    <LinearGradient colors={Gradients.hero} style={{ flex: 1 }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <LinearGradient colors={Gradients.buttonHero} style={styles.logoCircle}>
              <Ionicons name="location" size={36} color="#fff" />
            </LinearGradient>
            <Text style={styles.brand}>GRAVITY</Text>
            <Text style={styles.subtitle}>Welcome back to your family</Text>
          </View>
          <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="call-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+1 234 567 8900" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" autoComplete="tel" />
              </View>
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                <TextInput style={[styles.input, { flex: 1 }]} value={password} onChangeText={setPassword} placeholder="Enter your password" placeholderTextColor={Colors.textMuted} secureTextEntry={!showPassword} />
                <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textMuted} />
                </Pressable>
              </View>
            </View>
            {error ? <View style={styles.errorBox}><Ionicons name="alert-circle" size={16} color={Colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
            <PremiumButton title="Sign In" onPress={handleLogin} loading={loading} icon={<Ionicons name="arrow-forward" size={20} color="#fff" />} style={{ marginTop: 8 }} />
            <View style={styles.registerRow}>
              <Text style={styles.registerText}>New to Gravity? </Text>
              <Pressable onPress={() => navigation?.navigate('Register')}>
                <Text style={styles.registerLink}>Create account</Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40, gap: 32 },
  header: { alignItems: 'center', gap: 12 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 },
  brand: { fontSize: 32, fontWeight: '900', color: Colors.textWhite, letterSpacing: 6 },
  subtitle: { fontSize: 16, color: Colors.textSecondary, textAlign: 'center' },
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, height: 56 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  eyeBtn: { padding: 4 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(229,57,53,0.12)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(229,57,53,0.3)' },
  errorText: { color: Colors.danger, fontSize: 14, flex: 1 },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  registerText: { color: Colors.textMuted, fontSize: 15 },
  registerLink: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
})
