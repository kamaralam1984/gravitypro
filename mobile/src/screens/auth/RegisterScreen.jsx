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

const COUNTRIES = [
  { code: 'IN', label: 'India', flag: '🇮🇳' },
  { code: 'KE', label: 'Kenya', flag: '🇰🇪' },
  { code: 'AE', label: 'UAE', flag: '🇦🇪' },
  { code: 'GB', label: 'UK', flag: '🇬🇧' },
  { code: 'US', label: 'USA', flag: '🇺🇸' },
]

export default function RegisterScreen({ navigation }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [countryCode, setCountryCode] = useState('IN')
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

  const handleRegister = async () => {
    if (!name.trim() || !phone.trim() || !password) {
      setError('All fields are required')
      shake()
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      shake()
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      shake()
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await authAPI.register({ name: name.trim(), phone: phone.trim(), password, country_code: countryCode })
      await login(res.user, res.token)
    } catch (err) {
      setError(err.error || 'Registration failed. Please try again.')
      shake()
    } finally {
      setLoading(false)
    }
  }

  return (
    <LinearGradient colors={Gradients.hero} style={{ flex: 1 }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <LinearGradient colors={Gradients.buttonHero} style={styles.logoCircle}>
              <Ionicons name="people" size={36} color="#fff" />
            </LinearGradient>
            <Text style={styles.brand}>Join Gravity</Text>
            <Text style={styles.subtitle}>Connect with your family circle</Text>
          </View>

          <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your full name"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="call-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+1 234 567 8900"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Country</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.countryRow}>
                {COUNTRIES.map((c) => {
                  const selected = countryCode === c.code
                  return (
                    <Pressable
                      key={c.code}
                      onPress={() => setCountryCode(c.code)}
                      style={[styles.countryChip, selected && styles.countryChipSelected]}>
                      <Text style={styles.countryFlag}>{c.flag}</Text>
                      <Text style={[styles.countryLabel, selected && styles.countryLabelSelected]}>{c.label}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create a strong password"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry={!showPassword}
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textMuted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Repeat your password"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry={!showPassword}
                />
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <PremiumButton
              title="Create Account"
              onPress={handleRegister}
              loading={loading}
              icon={<Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
              style={{ marginTop: 8 }}
            />

            <View style={styles.loginRow}>
              <Text style={styles.loginText}>Already have an account? </Text>
              <Pressable onPress={() => navigation?.navigate('Login')}>
                <Text style={styles.loginLink}>Sign in</Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 70, paddingBottom: 40, gap: 28 },
  header: { alignItems: 'center', gap: 12 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 },
  brand: { fontSize: 28, fontWeight: '900', color: Colors.textWhite, letterSpacing: 1 },
  subtitle: { fontSize: 16, color: Colors.textSecondary, textAlign: 'center' },
  form: { gap: 18 },
  inputGroup: { gap: 8 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, height: 56 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  eyeBtn: { padding: 4 },
  countryRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  countryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border },
  countryChipSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(0,200,83,0.1)' },
  countryFlag: { fontSize: 18 },
  countryLabel: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  countryLabelSelected: { color: Colors.accent },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(229,57,53,0.12)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(229,57,53,0.3)' },
  errorText: { color: Colors.danger, fontSize: 14, flex: 1 },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  loginText: { color: Colors.textMuted, fontSize: 15 },
  loginLink: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
})
