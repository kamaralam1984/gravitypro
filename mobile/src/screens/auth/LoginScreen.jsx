import React, { useState, useRef } from 'react'
import {
  View, Text, TextInput, StyleSheet, ScrollView, Animated,
  KeyboardAvoidingView, Platform, Pressable, Alert,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { authAPI } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PremiumButton } from '../../components/ui/PremiumButton'
import { Colors, Gradients } from '../../theme/colors'

// ─── OTP digit refs helper ────────────────────────────────────────────────────
const OTP_LENGTH = 6

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

export default function LoginScreen({ navigation }) {
  // method: 'email' | 'phone' — Email is the PRIMARY method (free, no SMS cost).
  // Phone (SMS) is an optional fallback.
  const [method, setMethod] = useState('email')
  // step: 'phone' | 'otp'  (phone here means "identifier entry", reused for both methods)
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(''))
  const [devBanner, setDevBanner] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const login = useAuthStore(s => s.login)
  const shakeAnim = useRef(new Animated.Value(0)).current
  const otpRefs = useRef([])

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

  // ── Step 1: send OTP ────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    const trimmed = phone.trim()
    if (!trimmed) { setError('Please enter your phone number'); shake(); return }
    setLoading(true); setError(''); setDevBanner('')
    try {
      const res = await authAPI.sendOtp(trimmed)
      if (res?.dev_otp) {
        const digits = String(res.dev_otp).split('').slice(0, OTP_LENGTH)
        while (digits.length < OTP_LENGTH) digits.push('')
        setOtp(digits)
        setDevBanner(`Dev mode: OTP auto-filled (${res.dev_otp})`)
      } else {
        setOtp(Array(OTP_LENGTH).fill(''))
      }
      setStep('otp')
      setTimeout(() => otpRefs.current[0]?.focus(), 200)
    } catch (err) {
      setError(err?.error || err?.message || 'Failed to send OTP. Please try again.')
      shake()
    } finally { setLoading(false) }
  }

  // ── Step 2: verify OTP ──────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    const code = otp.join('')
    if (code.length < OTP_LENGTH) { setError('Enter all 6 digits'); shake(); return }
    setLoading(true); setError('')
    try {
      const res = await authAPI.verifyOtp(phone.trim(), code)
      await login(res.user, res.token)
    } catch (err) {
      if (err?.status === 404 || err?.code === 'USER_NOT_FOUND') {
        setError('No account found for this number.')
      } else {
        setError(err?.error || err?.message || 'Verification failed. Check the OTP and try again.')
      }
      shake()
    } finally { setLoading(false) }
  }

  // ── Email: send OTP ───────────────────────────────────────────────────────────
  const handleSendEmailOtp = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!isValidEmail(trimmed)) { setError('Please enter a valid email'); shake(); return }
    setLoading(true); setError(''); setDevBanner('')
    try {
      const res = await authAPI.sendEmailOtp(trimmed)
      if (res?.dev_otp) {
        const digits = String(res.dev_otp).split('').slice(0, OTP_LENGTH)
        while (digits.length < OTP_LENGTH) digits.push('')
        setOtp(digits)
        setDevBanner(`Dev mode: OTP auto-filled (${res.dev_otp})`)
      } else {
        setOtp(Array(OTP_LENGTH).fill(''))
      }
      setStep('otp')
      setTimeout(() => otpRefs.current[0]?.focus(), 200)
    } catch (err) {
      if (err?.status === 429) setError('Too many requests. Please wait a moment and try again.')
      else setError(err?.error || err?.message || 'Failed to send code. Please try again.')
      shake()
    } finally { setLoading(false) }
  }

  // ── Email: verify OTP (login) ─────────────────────────────────────────────────
  const handleVerifyEmailOtp = async () => {
    const code = otp.join('')
    if (code.length < OTP_LENGTH) { setError('Enter all 6 digits'); shake(); return }
    setLoading(true); setError('')
    try {
      const res = await authAPI.verifyEmailOtp(email.trim().toLowerCase(), code)
      await login(res.user, res.token)
    } catch (err) {
      if (err?.status === 404 || err?.code === 'USER_NOT_FOUND') {
        setError('No account found for this email.')
      } else {
        setError(err?.error || err?.message || 'Verification failed. Check the code and try again.')
      }
      shake()
    } finally { setLoading(false) }
  }

  // Unified resend / send based on active method
  const handleSend = () => (method === 'email' ? handleSendEmailOtp() : handleSendOtp())
  const handleVerify = () => (method === 'email' ? handleVerifyEmailOtp() : handleVerifyOtp())

  const switchMethod = (m) => {
    if (m === method) return
    setMethod(m)
    setStep('phone')
    setError(''); setDevBanner('')
    setOtp(Array(OTP_LENGTH).fill(''))
  }

  // ── Google Sign-In ──────────────────────────────────────────────────────────
  // Exchanges a Google id_token for a Gravity session.
  // Pass a real id_token here once Google OAuth is wired up (see TODO below).
  const signInWithGoogleToken = async (id_token) => {
    setGoogleLoading(true)
    setError('')
    try {
      const res = await authAPI.google(id_token)   // POST /auth/google
      await login(res.user, res.token)
    } catch (err) {
      setError(err?.error || err?.message || 'Google sign-in failed. Please try again.')
      shake()
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    // TODO: Wire up Google OAuth to obtain a real id_token, then call signInWithGoogleToken(id_token).
    //   1. Install deps:   npx expo install expo-auth-session expo-web-browser
    //   2. In app, import:  import * as Google from 'expo-auth-session/providers/google'
    //                       import * as WebBrowser from 'expo-web-browser'
    //                       WebBrowser.maybeCompleteAuthSession()
    //   3. Create Google OAuth client IDs (Web + Android + iOS) in Google Cloud Console
    //      and pass them to Google.useIdTokenAuthRequest({ androidClientId, iosClientId, webClientId }).
    //   4. On a successful response, grab response.params.id_token and call:
    //        signInWithGoogleToken(response.params.id_token)   // -> authAPI.google -> authStore.login
    Alert.alert('Google sign-in', 'Coming soon')
  }

  // ── OTP box change handler ──────────────────────────────────────────────────
  const handleOtpChange = (text, index) => {
    const digit = text.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    if (digit && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <LinearGradient colors={Gradients.hero} style={{ flex: 1 }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <LinearGradient colors={Gradients.buttonHero} style={styles.logoCircle}>
              <Ionicons name="location" size={36} color="#fff" />
            </LinearGradient>
            <Text style={styles.brand}>GRAVITY</Text>
            <Text style={styles.subtitle}>Welcome back to your family</Text>
          </View>

          <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>

            {/* Dev OTP banner */}
            {!!devBanner && (
              <View style={styles.devBanner}>
                <Ionicons name="bug-outline" size={16} color="#FFD600" />
                <Text style={styles.devBannerText}>{devBanner}</Text>
              </View>
            )}

            {step === 'phone' ? (
              <>
                {/* Method toggle: Email (primary) / Phone (optional) */}
                <View style={styles.methodRow}>
                  <Pressable
                    onPress={() => switchMethod('email')}
                    style={[styles.methodBtn, method === 'email' && styles.methodBtnSelected]}>
                    <Ionicons name="mail-outline" size={16} color={method === 'email' ? Colors.accent : Colors.textMuted} />
                    <Text style={[styles.methodLabel, method === 'email' && styles.methodLabelSelected]}>Email</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => switchMethod('phone')}
                    style={[styles.methodBtn, method === 'phone' && styles.methodBtnSelected]}>
                    <Ionicons name="call-outline" size={16} color={method === 'phone' ? Colors.accent : Colors.textMuted} />
                    <Text style={[styles.methodLabel, method === 'phone' && styles.methodLabelSelected]}>Phone</Text>
                  </Pressable>
                </View>

                {method === 'phone' ? (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Phone Number</Text>
                    <View style={styles.inputWrap}>
                      <Ionicons name="call-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={phone}
                        onChangeText={setPhone}
                        placeholder="+91 98765 43210"
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="phone-pad"
                        autoComplete="tel"
                        returnKeyType="done"
                        onSubmitEditing={handleSend}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Email Address</Text>
                    <View style={styles.inputWrap}>
                      <Ionicons name="mail-outline" size={20} color={Colors.accentSoft} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={email}
                        onChangeText={setEmail}
                        placeholder="you@example.com"
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        returnKeyType="done"
                        onSubmitEditing={handleSend}
                      />
                    </View>
                  </View>
                )}

                {!!error && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <PremiumButton
                  title={method === 'email' ? 'Send Code' : 'Send OTP'}
                  onPress={handleSend}
                  loading={loading}
                  icon={<Ionicons name="send-outline" size={20} color="#fff" />}
                  style={{ marginTop: 8 }}
                />
              </>
            ) : (
              <>
                {/* Identifier recap + back */}
                <View style={styles.phoneRecap}>
                  <Ionicons name={method === 'email' ? 'mail-outline' : 'call-outline'} size={16} color={Colors.accentSoft} />
                  <Text style={styles.phoneRecapText}>{method === 'email' ? email.trim().toLowerCase() : phone.trim()}</Text>
                  <Pressable onPress={() => { setStep('phone'); setError(''); setDevBanner('') }}>
                    <Text style={styles.changeLink}>Change</Text>
                  </Pressable>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Enter 6-digit OTP</Text>
                  <View style={styles.otpRow}>
                    {otp.map((digit, i) => (
                      <TextInput
                        key={i}
                        ref={el => otpRefs.current[i] = el}
                        style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
                        value={digit}
                        onChangeText={text => handleOtpChange(text, i)}
                        onKeyPress={e => handleOtpKeyPress(e, i)}
                        keyboardType="number-pad"
                        maxLength={1}
                        textAlign="center"
                        selectTextOnFocus
                      />
                    ))}
                  </View>
                </View>

                {!!error && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                    {(error.includes('No account') || error.includes('not found')) && (
                      <Pressable onPress={() => navigation?.navigate('Register')}>
                        <Text style={styles.inlineLink}> Create one?</Text>
                      </Pressable>
                    )}
                  </View>
                )}

                <PremiumButton
                  title="Verify & Sign In"
                  onPress={handleVerify}
                  loading={loading}
                  icon={<Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
                  style={{ marginTop: 8 }}
                />

                <Pressable onPress={handleSend} style={styles.resendRow}>
                  <Text style={styles.resendText}>Didn't receive it? </Text>
                  <Text style={styles.resendLink}>Resend {method === 'email' ? 'Code' : 'OTP'}</Text>
                </Pressable>
              </>
            )}

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Continue with Google */}
            <Pressable
              onPress={handleGoogleSignIn}
              disabled={googleLoading}
              style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="logo-google" size={20} color={Colors.textWhite} />
              <Text style={styles.googleBtnText}>
                {googleLoading ? 'Signing in…' : 'Continue with Google'}
              </Text>
            </Pressable>

            {/* Bottom link */}
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
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 12,
  },
  brand: { fontSize: 32, fontWeight: '900', color: Colors.textWhite, letterSpacing: 6 },
  subtitle: { fontSize: 16, color: Colors.textSecondary, textAlign: 'center' },
  form: { gap: 20 },
  devBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,214,0,0.12)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.4)',
  },
  devBannerText: { color: '#FFD600', fontSize: 13, flex: 1, fontWeight: '600' },
  inputGroup: { gap: 8 },
  methodRow: { flexDirection: 'row', gap: 10 },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 14,
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
  },
  methodBtnSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(0,230,118,0.1)' },
  methodLabel: { fontSize: 15, fontWeight: '700', color: Colors.textMuted },
  methodLabelSelected: { color: Colors.accent },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  phoneRecap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.bgCard, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  phoneRecapText: { flex: 1, color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  changeLink: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  otpRow: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  otpBox: {
    flex: 1, height: 56, borderRadius: 14,
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 22, fontWeight: '800',
  },
  otpBoxFilled: { borderColor: Colors.accent },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(229,57,53,0.12)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(229,57,53,0.3)',
  },
  errorText: { color: Colors.danger, fontSize: 14, flex: 1 },
  inlineLink: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  resendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  resendText: { color: Colors.textMuted, fontSize: 14 },
  resendLink: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.bgCard, borderRadius: 16, height: 54,
    borderWidth: 1, borderColor: Colors.border,
  },
  googleBtnText: { color: Colors.textWhite, fontSize: 16, fontWeight: '700' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  registerText: { color: Colors.textMuted, fontSize: 15 },
  registerLink: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
})
