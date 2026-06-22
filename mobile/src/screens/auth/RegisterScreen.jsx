import React, { useState, useRef } from 'react'
import {
  View, Text, TextInput, StyleSheet, ScrollView, Animated,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { authAPI } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PremiumButton } from '../../components/ui/PremiumButton'
import { Colors, Gradients } from '../../theme/colors'

const OTP_LENGTH = 6

const COUNTRIES = [
  { code: 'IN', label: 'India', flag: '🇮🇳' },
  { code: 'KE', label: 'Kenya', flag: '🇰🇪' },
  { code: 'AE', label: 'UAE', flag: '🇦🇪' },
  { code: 'GB', label: 'UK', flag: '🇬🇧' },
  { code: 'US', label: 'USA', flag: '🇺🇸' },
]

const ACCOUNT_TYPES = [
  { value: 'parent', label: 'Parent 👨‍👩‍👧' },
  { value: 'child', label: 'Child 👦' },
]

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const isValidName = (name) => name.trim().length >= 2

// ── Step progress dots ────────────────────────────────────────────────────────
function StepDots({ current, total }) {
  return (
    <View style={stepStyles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            stepStyles.dot,
            i < current ? stepStyles.dotDone : i === current ? stepStyles.dotActive : stepStyles.dotIdle,
          ]}
        />
      ))}
    </View>
  )
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotActive: { width: 28, backgroundColor: Colors.accent },
  dotDone: { backgroundColor: Colors.accentSoft || '#00C853' },
  dotIdle: { backgroundColor: Colors.border || '#1A3A2A' },
})

// ── Validation indicator ──────────────────────────────────────────────────────
function FieldStatus({ valid, show }) {
  if (!show) return null
  return (
    <Ionicons
      name={valid ? 'checkmark-circle' : 'close-circle'}
      size={18}
      color={valid ? Colors.accent : Colors.danger}
    />
  )
}

export default function RegisterScreen({ navigation }) {
  // step: 0 = phone, 1 = phone otp, 2 = profile, 3 = email otp
  const [step, setStep] = useState(0)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(''))
  const [phoneToken, setPhoneToken] = useState(null)
  const [devBanner, setDevBanner] = useState('')

  // Email OTP
  const [emailOtp, setEmailOtp] = useState(Array(OTP_LENGTH).fill(''))
  const [emailToken, setEmailToken] = useState(null)
  const [emailDevBanner, setEmailDevBanner] = useState('')
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false)

  // Profile fields
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [accountType, setAccountType] = useState('parent')
  const [countryCode, setCountryCode] = useState('IN')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)

  const login = useAuthStore(s => s.login)
  const shakeAnim = useRef(new Animated.Value(0)).current
  const otpRefs = useRef([])
  const emailOtpRefs = useRef([])

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

  // ── Step 0: Send OTP ────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    const trimmed = phone.trim()
    if (!trimmed) { setError('Please enter your phone number'); shake(); return }
    setLoading(true); setError(''); setDevBanner(''); setAlreadyRegistered(false)
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
      setStep(1)
      setTimeout(() => otpRefs.current[0]?.focus(), 200)
    } catch (err) {
      setError(err?.error || err?.message || 'Failed to send OTP. Please try again.')
      shake()
    } finally { setLoading(false) }
  }

  // ── Step 1: Verify Phone ────────────────────────────────────────────────────
  const handleVerifyPhone = async () => {
    const code = otp.join('')
    if (code.length < OTP_LENGTH) { setError('Enter all 6 digits'); shake(); return }
    setLoading(true); setError(''); setAlreadyRegistered(false)
    try {
      const res = await authAPI.verifyPhone(phone.trim(), code)
      if (res?.already_registered) {
        setAlreadyRegistered(true)
        shake()
        return
      }
      setPhoneToken(res.phone_token)
      setStep(2)
    } catch (err) {
      if (err?.already_registered || err?.code === 'ALREADY_REGISTERED') {
        setAlreadyRegistered(true)
        shake()
      } else {
        setError(err?.error || err?.message || 'Verification failed. Check the OTP and try again.')
        shake()
      }
    } finally { setLoading(false) }
  }

  // ── OTP box helpers ─────────────────────────────────────────────────────────
  const handleOtpChange = (text, index) => {
    const digit = text.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    if (digit && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus()
  }

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  // ── Email OTP box helpers ─────────────────────────────────────────────────────
  const handleEmailOtpChange = (text, index) => {
    const digit = text.replace(/\D/g, '').slice(-1)
    const next = [...emailOtp]
    next[index] = digit
    setEmailOtp(next)
    if (digit && index < OTP_LENGTH - 1) emailOtpRefs.current[index + 1]?.focus()
  }

  const handleEmailOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !emailOtp[index] && index > 0) {
      emailOtpRefs.current[index - 1]?.focus()
    }
  }

  // ── Step 2 -> 3: send email OTP ───────────────────────────────────────────────
  const canSubmit = isValidName(name) && isValidEmail(email)

  const handleSendEmailOtp = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!canSubmit) { setError('Please fill in a valid name and email'); shake(); return }
    setLoading(true); setError(''); setEmailDevBanner(''); setEmailAlreadyRegistered(false)
    try {
      const res = await authAPI.sendEmailOtp(trimmed)
      if (res?.dev_otp) {
        const digits = String(res.dev_otp).split('').slice(0, OTP_LENGTH)
        while (digits.length < OTP_LENGTH) digits.push('')
        setEmailOtp(digits)
        setEmailDevBanner(`Dev mode: OTP auto-filled (${res.dev_otp})`)
      } else {
        setEmailOtp(Array(OTP_LENGTH).fill(''))
      }
      setStep(3)
      setTimeout(() => emailOtpRefs.current[0]?.focus(), 200)
    } catch (err) {
      if (err?.status === 429) setError('Too many requests. Please wait a moment and try again.')
      else setError(err?.error || err?.message || 'Failed to send email code. Please try again.')
      shake()
    } finally { setLoading(false) }
  }

  // ── Step 3: verify email OTP -> email_token -> register ───────────────────────
  const handleVerifyEmailAndRegister = async () => {
    const code = emailOtp.join('')
    if (code.length < OTP_LENGTH) { setError('Enter all 6 digits'); shake(); return }
    setLoading(true); setError(''); setEmailAlreadyRegistered(false)
    try {
      const verifyRes = await authAPI.verifyEmail(email.trim().toLowerCase(), code)
      if (verifyRes?.already_registered) {
        setEmailAlreadyRegistered(true)
        shake()
        return
      }
      const token = verifyRes.email_token
      const res = await authAPI.registerFree({
        phone_token: phoneToken,
        email_token: token,
        name: name.trim(),
        account_type: accountType,
        country_code: countryCode,
      })
      setEmailToken(token)
      await login(res.user, res.token)
    } catch (err) {
      if (err?.already_registered || err?.code === 'ALREADY_REGISTERED') {
        setEmailAlreadyRegistered(true)
        shake()
      } else {
        setError(err?.error || err?.message || 'Verification failed. Check the code and try again.')
        shake()
      }
    } finally { setLoading(false) }
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
              <Ionicons name="people" size={36} color="#fff" />
            </LinearGradient>
            <Text style={styles.brand}>Join Gravity</Text>
            <Text style={styles.subtitle}>Connect with your family circle</Text>
            <StepDots current={step} total={4} />
          </View>

          <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>

            {/* Dev OTP banner */}
            {!!devBanner && (
              <View style={styles.devBanner}>
                <Ionicons name="bug-outline" size={16} color="#FFD600" />
                <Text style={styles.devBannerText}>{devBanner}</Text>
              </View>
            )}

            {/* ── STEP 0: Phone ───────────────────────────────────────────── */}
            {step === 0 && (
              <>
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
                      onSubmitEditing={handleSendOtp}
                    />
                  </View>
                </View>

                {!!error && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <PremiumButton
                  title="Send OTP"
                  onPress={handleSendOtp}
                  loading={loading}
                  icon={<Ionicons name="send-outline" size={20} color="#fff" />}
                  style={{ marginTop: 8 }}
                />
              </>
            )}

            {/* ── STEP 1: OTP ─────────────────────────────────────────────── */}
            {step === 1 && (
              <>
                {/* Phone recap */}
                <View style={styles.phoneRecap}>
                  <Ionicons name="call-outline" size={16} color={Colors.accentSoft} />
                  <Text style={styles.phoneRecapText}>{phone.trim()}</Text>
                  <Pressable onPress={() => { setStep(0); setError(''); setDevBanner(''); setAlreadyRegistered(false) }}>
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

                {/* Already registered notice */}
                {alreadyRegistered && (
                  <View style={styles.infoBox}>
                    <Ionicons name="information-circle" size={16} color={Colors.accent} />
                    <Text style={styles.infoText}>Phone already registered. </Text>
                    <Pressable onPress={() => navigation?.navigate('Login')}>
                      <Text style={styles.inlineLink}>Sign in instead.</Text>
                    </Pressable>
                  </View>
                )}

                {!!error && !alreadyRegistered && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <PremiumButton
                  title="Verify Phone"
                  onPress={handleVerifyPhone}
                  loading={loading}
                  icon={<Ionicons name="shield-checkmark-outline" size={20} color="#fff" />}
                  style={{ marginTop: 8 }}
                />

                <Pressable onPress={handleSendOtp} style={styles.resendRow}>
                  <Text style={styles.resendText}>Didn't receive it? </Text>
                  <Text style={styles.resendLink}>Resend OTP</Text>
                </Pressable>
              </>
            )}

            {/* ── STEP 2: Profile ──────────────────────────────────────────── */}
            {step === 2 && (
              <>
                {/* Name */}
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
                      autoComplete="name"
                    />
                    <FieldStatus valid={isValidName(name)} show={name.length > 0} />
                  </View>
                </View>

                {/* Email */}
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
                    />
                    <FieldStatus valid={isValidEmail(email)} show={email.length > 0} />
                  </View>
                </View>

                {/* Account type */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Account Type</Text>
                  <View style={styles.toggleRow}>
                    {ACCOUNT_TYPES.map((type) => {
                      const selected = accountType === type.value
                      return (
                        <Pressable
                          key={type.value}
                          onPress={() => setAccountType(type.value)}
                          style={[styles.toggleBtn, selected && styles.toggleBtnSelected]}>
                          <Text style={[styles.toggleLabel, selected && styles.toggleLabelSelected]}>
                            {type.label}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>

                {/* Country */}
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

                {!!error && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <PremiumButton
                  title="Continue"
                  onPress={handleSendEmailOtp}
                  loading={loading}
                  disabled={!canSubmit}
                  icon={<Ionicons name="arrow-forward-circle-outline" size={20} color="#fff" />}
                  style={{ marginTop: 8 }}
                />
              </>
            )}

            {/* ── STEP 3: Email OTP ────────────────────────────────────────── */}
            {step === 3 && (
              <>
                {/* Email dev banner */}
                {!!emailDevBanner && (
                  <View style={styles.devBanner}>
                    <Ionicons name="bug-outline" size={16} color="#FFD600" />
                    <Text style={styles.devBannerText}>{emailDevBanner}</Text>
                  </View>
                )}

                {/* Email recap */}
                <View style={styles.phoneRecap}>
                  <Ionicons name="mail-outline" size={16} color={Colors.accentSoft} />
                  <Text style={styles.phoneRecapText}>{email.trim().toLowerCase()}</Text>
                  <Pressable onPress={() => { setStep(2); setError(''); setEmailDevBanner(''); setEmailAlreadyRegistered(false) }}>
                    <Text style={styles.changeLink}>Change</Text>
                  </Pressable>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Enter Email Code</Text>
                  <View style={styles.otpRow}>
                    {emailOtp.map((digit, i) => (
                      <TextInput
                        key={i}
                        ref={el => emailOtpRefs.current[i] = el}
                        style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
                        value={digit}
                        onChangeText={text => handleEmailOtpChange(text, i)}
                        onKeyPress={e => handleEmailOtpKeyPress(e, i)}
                        keyboardType="number-pad"
                        maxLength={1}
                        textAlign="center"
                        selectTextOnFocus
                      />
                    ))}
                  </View>
                </View>

                {/* Email already registered notice */}
                {emailAlreadyRegistered && (
                  <View style={styles.infoBox}>
                    <Ionicons name="information-circle" size={16} color={Colors.accent} />
                    <Text style={styles.infoText}>Email already registered. </Text>
                    <Pressable onPress={() => navigation?.navigate('Login')}>
                      <Text style={styles.inlineLink}>Sign in instead.</Text>
                    </Pressable>
                  </View>
                )}

                {!!error && !emailAlreadyRegistered && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <PremiumButton
                  title="Verify & Create Account"
                  onPress={handleVerifyEmailAndRegister}
                  loading={loading}
                  icon={<Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
                  style={{ marginTop: 8 }}
                />

                <Pressable onPress={handleSendEmailOtp} style={styles.resendRow}>
                  <Text style={styles.resendText}>Didn't receive it? </Text>
                  <Text style={styles.resendLink}>Resend Code</Text>
                </Pressable>
              </>
            )}

            {/* Bottom link */}
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
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 12,
  },
  brand: { fontSize: 28, fontWeight: '900', color: Colors.textWhite, letterSpacing: 1 },
  subtitle: { fontSize: 16, color: Colors.textSecondary, textAlign: 'center' },
  form: { gap: 18 },
  devBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,214,0,0.12)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.4)',
  },
  devBannerText: { color: '#FFD600', fontSize: 13, flex: 1, fontWeight: '600' },
  inputGroup: { gap: 8 },
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
  infoBox: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4,
    backgroundColor: 'rgba(0,230,118,0.08)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.25)',
  },
  infoText: { color: Colors.textSecondary, fontSize: 14 },
  inlineLink: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(229,57,53,0.12)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(229,57,53,0.3)',
  },
  errorText: { color: Colors.danger, fontSize: 14, flex: 1 },
  resendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  resendText: { color: Colors.textMuted, fontSize: 14 },
  resendLink: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 12 },
  toggleBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center',
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
  },
  toggleBtnSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(0,230,118,0.1)' },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: Colors.textMuted },
  toggleLabelSelected: { color: Colors.accent },
  countryRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  countryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, backgroundColor: Colors.bgCard,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  countryChipSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(0,230,118,0.1)' },
  countryFlag: { fontSize: 18 },
  countryLabel: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  countryLabelSelected: { color: Colors.accent },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  loginText: { color: Colors.textMuted, fontSize: 15 },
  loginLink: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
})
