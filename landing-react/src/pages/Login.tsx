import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import styles from './Login.module.css'

const API = window.location.origin + '/api/v1'

function validatePhone(phone: string): boolean {
  const clean = phone.replace(/[\s\-().]/g, '')
  return clean.length >= 8 && /^[+\d]/.test(clean)
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validateName(name: string): boolean {
  return name.trim().length >= 2
}

type Tab = 'login' | 'register'
type LoginStep = 1 | 2
type RegStep = 1 | 2 | 3 | 4

const COUNTRIES = [
  { code: 'IN', label: 'India' },
  { code: 'KE', label: 'Kenya' },
  { code: 'UG', label: 'Uganda' },
  { code: 'TZ', label: 'Tanzania' },
  { code: 'GB', label: 'UK' },
  { code: 'US', label: 'USA' },
  { code: 'AE', label: 'UAE' },
  { code: 'PK', label: 'Pakistan' },
  { code: 'OT', label: 'Other' },
]

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState<Tab>('login')

  // ── LOGIN STATE ──────────────────────────────────────────────
  const [loginStep, setLoginStep] = useState<LoginStep>(1)
  const [loginPhone, setLoginPhone] = useState('')
  const [loginOtp, setLoginOtp] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginDevBanner, setLoginDevBanner] = useState('')

  // ── REGISTER STATE ───────────────────────────────────────────
  const [regStep, setRegStep] = useState<RegStep>(1)
  const [regPhone, setRegPhone] = useState('')
  const [regOtp, setRegOtp] = useState('')
  const [regPhoneToken, setRegPhoneToken] = useState('')
  const [regDevBanner, setRegDevBanner] = useState('')

  // Step 3 — details
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regAccountType, setRegAccountType] = useState<'parent' | 'child'>('parent')
  const [regCountry, setRegCountry] = useState('IN')

  // Step 3 — touched state for live validation
  const [nameTouched, setNameTouched] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)

  // Derived real-time validity
  const nameValid = validateName(regName)
  const emailValid = validateEmail(regEmail)
  const detailsAllValid = nameValid && emailValid

  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState('')

  // OTP input ref for auto-focus
  const loginOtpRef = useRef<HTMLInputElement>(null)
  const regOtpRef = useRef<HTMLInputElement>(null)

  // ── REDIRECT IF ALREADY LOGGED IN ────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('gravity_token')
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        if (payload.exp && payload.exp * 1000 > Date.now()) {
          const urlRedirect = searchParams.get('redirect')
          const savedRedirect = localStorage.getItem('gravity_redirect')
          localStorage.removeItem('gravity_redirect')
          const dest = urlRedirect || savedRedirect
          if (dest) { navigate(dest); return }
          const storedUser = JSON.parse(localStorage.getItem('gravity_user') || 'null')
          navigate(storedUser?.account_type === 'child' ? '/child/panel' : '/parent/panel')
        }
      } catch {
        localStorage.removeItem('gravity_token')
        localStorage.removeItem('gravity_user')
      }
    }
  }, [])

  // ── AUTO-DETECT HASH ─────────────────────────────────────────
  useEffect(() => {
    if (window.location.hash === '#register') setActiveTab('register')
  }, [])

  // ── FOCUS OTP INPUTS WHEN STEP CHANGES ───────────────────────
  useEffect(() => {
    if (loginStep === 2) setTimeout(() => loginOtpRef.current?.focus(), 80)
  }, [loginStep])

  useEffect(() => {
    if (regStep === 2) setTimeout(() => regOtpRef.current?.focus(), 80)
  }, [regStep])

  // ── HELPERS ──────────────────────────────────────────────────
  function onLoginSuccess(data: { token: string; user: Record<string, unknown> }) {
    localStorage.setItem('gravity_token', data.token)
    localStorage.setItem('gravity_user', JSON.stringify(data.user))
    const urlRedirect = searchParams.get('redirect')
    const savedRedirect = localStorage.getItem('gravity_redirect')
    localStorage.removeItem('gravity_redirect')
    const dest = urlRedirect || savedRedirect
    if (dest) { navigate(dest); return }
    const type = (data.user?.account_type as string) || 'parent'
    navigate(type === 'child' ? '/child/panel' : '/parent/panel')
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    setLoginError('')
    setRegError('')
    setLoginStep(1)
    setLoginOtp('')
    setLoginDevBanner('')
    setRegStep(1)
    setRegOtp('')
    setRegDevBanner('')
    setRegPhoneToken('')
    setNameTouched(false)
    setEmailTouched(false)
  }

  // ── LOGIN ACTIONS ────────────────────────────────────────────
  async function doLoginSendOtp() {
    setLoginError('')
    const phone = loginPhone.trim()
    if (!phone || !validatePhone(phone)) {
      setLoginError('Please enter a valid phone number.')
      return
    }
    setLoginLoading(true)
    try {
      const res = await fetch(API + '/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      if (data.dev_otp) {
        const otp = String(data.dev_otp)
        setLoginOtp(otp)
        setLoginDevBanner(otp)
      }
      setLoginStep(2)
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Failed to send OTP')
    } finally {
      setLoginLoading(false)
    }
  }

  async function doLoginVerify() {
    setLoginError('')
    const phone = loginPhone.trim()
    const otp = loginOtp.trim()
    if (!otp || otp.length < 6) {
      setLoginError('Please enter the 6-digit OTP.')
      return
    }
    setLoginLoading(true)
    try {
      const res = await fetch(API + '/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      onLoginSuccess(data)
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  // ── REGISTER ACTIONS ─────────────────────────────────────────
  async function doRegSendOtp() {
    setRegError('')
    const phone = regPhone.trim()
    if (!phone || !validatePhone(phone)) {
      setRegError('Please enter a valid phone number.')
      return
    }
    setRegLoading(true)
    try {
      const res = await fetch(API + '/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      if (data.dev_otp) {
        const otp = String(data.dev_otp)
        setRegOtp(otp)
        setRegDevBanner(otp)
      }
      setRegStep(2)
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'Failed to send OTP')
    } finally {
      setRegLoading(false)
    }
  }

  async function doRegVerifyPhone() {
    setRegError('')
    const phone = regPhone.trim()
    const otp = regOtp.trim()
    if (!otp || otp.length < 6) {
      setRegError('Please enter the 6-digit OTP.')
      return
    }
    setRegLoading(true)
    try {
      const res = await fetch(API + '/auth/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'OTP verification failed')
      if (data.already_registered) {
        // Switch to login tab
        switchTab('login')
        setLoginPhone(phone)
        return
      }
      setRegPhoneToken(data.phone_token)
      setRegStep(3)
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'OTP verification failed')
    } finally {
      setRegLoading(false)
    }
  }

  function doGoToPlan() {
    if (!detailsAllValid) return
    if (regAccountType === 'child') {
      doRegisterFree()
    } else {
      setRegStep(4)
    }
  }

  async function doRegisterFree() {
    setRegError('')
    setRegLoading(true)
    try {
      const res = await fetch(API + '/auth/register-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_token: regPhoneToken,
          name: regName.trim(),
          email: regEmail.trim(),
          account_type: regAccountType,
          country_code: regCountry,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      onLoginSuccess(data)
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'Registration failed')
      setRegStep(3)
    } finally {
      setRegLoading(false)
    }
  }

  async function doRegisterPaid(plan: 'family' | 'premium') {
    setRegError('')
    setRegLoading(true)
    try {
      const ok = await loadRazorpay()
      if (!ok) throw new Error('Failed to load payment gateway. Please try again.')

      const orderRes = await fetch(API + '/payments/create-order-anon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_token: regPhoneToken,
          plan,
          gateway: 'razorpay',
          currency: 'INR',
          name: regName.trim(),
          email: regEmail.trim(),
        }),
      })
      const orderData = await orderRes.json()
      if (!orderRes.ok) throw new Error(orderData.error || 'Failed to create payment order')

      const { orderId, clientData } = orderData

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: clientData?.key,
          order_id: orderId,
          name: 'Gravity Family Safety',
          description: plan === 'family' ? 'Family Plan — ₹299/mo' : 'Premium Plan — ₹499/mo',
          image: '/favicon.ico',
          prefill: {
            name: regName.trim(),
            email: regEmail.trim(),
          },
          theme: { color: '#00E676' },
          handler: async (response: {
            razorpay_order_id: string
            razorpay_payment_id: string
            razorpay_signature: string
          }) => {
            try {
              const regRes = await fetch(API + '/auth/register-with-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  phone_token: regPhoneToken,
                  name: regName.trim(),
                  email: regEmail.trim(),
                  account_type: regAccountType,
                  country_code: regCountry,
                  plan,
                  gateway: 'razorpay',
                  gatewayOrderId: response.razorpay_order_id,
                  gatewayPaymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature,
                }),
              })
              const regData = await regRes.json()
              if (!regRes.ok) throw new Error(regData.error || 'Registration failed after payment')
              onLoginSuccess(regData)
              resolve()
            } catch (e) {
              reject(e)
            }
          },
          modal: {
            ondismiss: () => reject(new Error('Payment cancelled')),
          },
        })
        rzp.open()
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      if (msg !== 'Payment cancelled') setRegError(msg)
    } finally {
      setRegLoading(false)
    }
  }

  // ── RENDER HELPERS ───────────────────────────────────────────
  function DevBanner({ otp }: { otp: string }) {
    return (
      <div className={styles.devBanner}>
        <span>🔧 Dev mode — OTP:</span>
        <span className={styles.devOtpCode}>{otp}</span>
      </div>
    )
  }

  function OtpInput({
    value,
    onChange,
    inputRef,
  }: {
    value: string
    onChange: (v: string) => void
    inputRef?: RefObject<HTMLInputElement | null>
  }) {
    return (
      <div className={styles.otpBox}>
        <div className={styles.otpLabel}>ENTER 6-DIGIT OTP</div>
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          className={styles.otpInput}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          autoComplete="one-time-code"
        />
        <div className={styles.otpDots}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`${styles.otpDot} ${value.length > i ? styles.otpDotFilled : ''}`}
            />
          ))}
        </div>
      </div>
    )
  }

  function ValidationIcon({ valid, touched }: { valid: boolean; touched: boolean }) {
    if (!touched) return null
    return valid ? (
      <span className={styles.validIcon}>✓</span>
    ) : (
      <span className={styles.invalidIcon}>✗</span>
    )
  }

  // ── REGISTER PROGRESS DOTS ────────────────────────────────────
  function RegDots() {
    // steps 2, 3, 4 show progress; step 1 = phone entry (no dots yet)
    if (regStep === 1) return null
    const dots = [2, 3, 4] as RegStep[]
    return (
      <div className={styles.progressDots}>
        {dots.map((s) => (
          <div
            key={s}
            className={`${styles.progressDot} ${regStep === s ? styles.progressDotActive : ''} ${regStep > s ? styles.progressDotDone : ''}`}
          />
        ))}
      </div>
    )
  }

  // ── PLAN STEP LABELS ─────────────────────────────────────────
  const regStepLabel: Record<RegStep, string> = {
    1: 'Phone Number',
    2: 'Verify Phone',
    3: 'Your Details',
    4: 'Choose Plan',
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageWrap}>

        {/* LOGO */}
        <Link to="/" className={styles.logoArea}>
          <div className={styles.logoMark}>
            <svg width="36" height="40" viewBox="0 0 52 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M26 2C15.507 2 7 10.507 7 21C7 35.5 26 54 26 54C26 54 45 35.5 45 21C45 10.507 36.493 2 26 2Z" fill="url(#pin_grad)" stroke="rgba(0,230,118,0.3)" strokeWidth="0.5"/>
              <circle cx="26" cy="21" r="9" fill="#020C05" opacity="0.8"/>
              <circle cx="26" cy="21" r="4.5" fill="url(#dot_grad)"/>
              <defs>
                <linearGradient id="pin_grad" x1="26" y1="2" x2="26" y2="54" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00E676"/>
                  <stop offset="100%" stopColor="#00FFB2"/>
                </linearGradient>
                <linearGradient id="dot_grad" x1="21.5" y1="16.5" x2="30.5" y2="25.5" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00FFB2"/>
                  <stop offset="100%" stopColor="#00E676"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className={styles.logoText}>📍 GRAVITY</span>
        </Link>

        {/* AUTH CARD */}
        <div className={styles.authCard}>

          {/* TAB BAR */}
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'login' ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('login')}
            >
              Sign In
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === 'register' ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('register')}
            >
              Create Account
            </button>
            <div className={`${styles.tabIndicator} ${activeTab === 'register' ? styles.tabIndicatorRight : ''}`} />
          </div>

          {/* ═══════════════════════════════════════════════════
              LOGIN PANEL
          ═══════════════════════════════════════════════════ */}
          <div className={`${styles.panel} ${activeTab === 'login' ? styles.panelActive : ''}`}>

            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Welcome back</h2>
              <p className={styles.panelSub}>Sign in to keep your family connected</p>
            </div>

            {loginError && (
              <div className={styles.errorBanner}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {loginError}
              </div>
            )}

            {/* STEP 1 — Phone */}
            {loginStep === 1 && (
              <form onSubmit={(e) => { e.preventDefault(); doLoginSendOtp() }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="login-phone">Phone Number</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                      </svg>
                    </span>
                    <input
                      type="tel"
                      id="login-phone"
                      className={styles.fieldInput}
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                      inputMode="tel"
                      value={loginPhone}
                      onChange={(e) => { setLoginPhone(e.target.value); setLoginError('') }}
                    />
                  </div>
                </div>
                <button
                  className={`${styles.btnPrimary} ${loginLoading ? styles.btnLoading : ''}`}
                  type="submit"
                  disabled={loginLoading}
                >
                  {loginLoading ? <span className={styles.spinner} /> : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                      </svg>
                      Send OTP
                    </>
                  )}
                </button>
              </form>
            )}

            {/* STEP 2 — OTP + Sign In */}
            {loginStep === 2 && (
              <form onSubmit={(e) => { e.preventDefault(); doLoginVerify() }}>
                {loginDevBanner && <DevBanner otp={loginDevBanner} />}
                <p className={styles.stepHint}>
                  OTP sent to <strong>{loginPhone}</strong>
                </p>
                <OtpInput
                  value={loginOtp}
                  onChange={(v) => { setLoginOtp(v); setLoginError('') }}
                  inputRef={loginOtpRef}
                />
                <button
                  className={`${styles.btnPrimary} ${loginLoading ? styles.btnLoading : ''}`}
                  type="submit"
                  disabled={loginLoading || loginOtp.length < 6}
                >
                  {loginLoading ? <span className={styles.spinner} /> : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                      </svg>
                      Verify &amp; Sign In
                    </>
                  )}
                </button>
                <div className={styles.resendRow}>
                  Didn&apos;t receive it?{' '}
                  <button
                    type="button"
                    className={styles.resendBtn}
                    onClick={() => { setLoginStep(1); setLoginOtp(''); setLoginDevBanner(''); setLoginError('') }}
                  >
                    Resend OTP
                  </button>
                </div>
              </form>
            )}

            <div className={styles.formFooter}>
              Don&apos;t have an account?{' '}
              <button type="button" className={styles.switchTabBtn} onClick={() => switchTab('register')}>
                Create one free
              </button>
            </div>
          </div>
          {/* /LOGIN PANEL */}

          {/* ═══════════════════════════════════════════════════
              REGISTER PANEL
          ═══════════════════════════════════════════════════ */}
          <div className={`${styles.panel} ${activeTab === 'register' ? styles.panelActive : ''}`}>

            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Create your account</h2>
              <p className={styles.panelSub}>
                {activeTab === 'register' ? regStepLabel[regStep] : ''}
              </p>
            </div>

            <RegDots />

            {regError && (
              <div className={styles.errorBanner}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {regError}
              </div>
            )}

            {/* REG STEP 1 — Phone */}
            {regStep === 1 && (
              <form onSubmit={(e) => { e.preventDefault(); doRegSendOtp() }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-phone">Phone Number</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                      </svg>
                    </span>
                    <input
                      type="tel"
                      id="reg-phone"
                      className={styles.fieldInput}
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                      inputMode="tel"
                      value={regPhone}
                      onChange={(e) => { setRegPhone(e.target.value); setRegError('') }}
                    />
                  </div>
                </div>
                <button
                  className={`${styles.btnPrimary} ${regLoading ? styles.btnLoading : ''}`}
                  type="submit"
                  disabled={regLoading}
                >
                  {regLoading ? <span className={styles.spinner} /> : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                      </svg>
                      Send OTP
                    </>
                  )}
                </button>
                <div className={styles.termsText}>
                  By continuing you agree to our{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                </div>
              </form>
            )}

            {/* REG STEP 2 — OTP Verify */}
            {regStep === 2 && (
              <form onSubmit={(e) => { e.preventDefault(); doRegVerifyPhone() }}>
                {regDevBanner && <DevBanner otp={regDevBanner} />}
                <p className={styles.stepHint}>
                  OTP sent to <strong>{regPhone}</strong>
                </p>
                <OtpInput
                  value={regOtp}
                  onChange={(v) => { setRegOtp(v); setRegError('') }}
                  inputRef={regOtpRef}
                />
                <button
                  className={`${styles.btnPrimary} ${regLoading ? styles.btnLoading : ''}`}
                  type="submit"
                  disabled={regLoading || regOtp.length < 6}
                >
                  {regLoading ? <span className={styles.spinner} /> : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Verify Phone
                    </>
                  )}
                </button>
                <div className={styles.resendRow}>
                  Didn&apos;t receive it?{' '}
                  <button
                    type="button"
                    className={styles.resendBtn}
                    onClick={() => { setRegStep(1); setRegOtp(''); setRegDevBanner(''); setRegError('') }}
                  >
                    Resend OTP
                  </button>
                </div>
              </form>
            )}

            {/* REG STEP 3 — Details */}
            {regStep === 3 && (
              <form onSubmit={(e) => { e.preventDefault(); doGoToPlan() }}>

                {/* Full Name */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-name">Full Name</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <input
                      type="text"
                      id="reg-name"
                      className={`${styles.fieldInput} ${nameTouched && !nameValid ? styles.fieldInputError : ''} ${nameTouched && nameValid ? styles.fieldInputValid : ''}`}
                      placeholder="Priya Sharma"
                      autoComplete="name"
                      value={regName}
                      onChange={(e) => { setRegName(e.target.value); setNameTouched(true) }}
                      onBlur={() => setNameTouched(true)}
                    />
                    <ValidationIcon valid={nameValid} touched={nameTouched} />
                  </div>
                  {nameTouched && !nameValid && (
                    <p className={styles.fieldError}>Please enter your full name (min 2 characters)</p>
                  )}
                </div>

                {/* Email */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-email">Email Address</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </span>
                    <input
                      type="email"
                      id="reg-email"
                      className={`${styles.fieldInput} ${emailTouched && !emailValid ? styles.fieldInputError : ''} ${emailTouched && emailValid ? styles.fieldInputValid : ''}`}
                      placeholder="priya@example.com"
                      autoComplete="email"
                      inputMode="email"
                      value={regEmail}
                      onChange={(e) => { setRegEmail(e.target.value); setEmailTouched(true) }}
                      onBlur={() => setEmailTouched(true)}
                    />
                    <ValidationIcon valid={emailValid} touched={emailTouched} />
                  </div>
                  {emailTouched && !emailValid && (
                    <p className={styles.fieldError}>Please enter a valid email address</p>
                  )}
                </div>

                {/* Account Type */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Account Type</label>
                  <div className={styles.accountTypeRow}>
                    <button
                      type="button"
                      className={`${styles.accountTypeBtn} ${regAccountType === 'parent' ? styles.accountTypeBtnActive : ''}`}
                      onClick={() => setRegAccountType('parent')}
                    >
                      <span className={styles.accountTypeIcon}>👨‍👩‍👧‍👦</span>
                      <span>Parent</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.accountTypeBtn} ${regAccountType === 'child' ? styles.accountTypeBtnActive : ''}`}
                      onClick={() => setRegAccountType('child')}
                    >
                      <span className={styles.accountTypeIcon}>👦</span>
                      <span>Child</span>
                    </button>
                  </div>
                </div>

                {/* Country */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-country">Country</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                      </svg>
                    </span>
                    <select
                      id="reg-country"
                      className={styles.fieldSelect}
                      value={regCountry}
                      onChange={(e) => setRegCountry(e.target.value)}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  className={`${styles.btnPrimary} ${!detailsAllValid ? styles.btnDisabled : ''} ${regLoading ? styles.btnLoading : ''}`}
                  type="submit"
                  disabled={!detailsAllValid || regLoading}
                >
                  {regLoading ? 'Creating Account...' : regAccountType === 'child' ? 'Create Account →' : 'Continue to Plan →'}
                </button>
              </form>
            )}

            {/* REG STEP 4 — Plan Selection */}
            {regStep === 4 && (
              <div>
                <div className={styles.planGrid}>

                  {/* FREE */}
                  <div className={styles.planCard}>
                    <div className={styles.planName}>Free Forever</div>
                    <div className={styles.planPrice}>
                      <span className={styles.planCurrency}>₹</span>0
                      <span className={styles.planPer}>/month</span>
                    </div>
                    <ul className={styles.planFeatures}>
                      <li>Up to 2 family members</li>
                      <li>Real-time location</li>
                      <li>Basic SOS alerts</li>
                    </ul>
                    <button
                      className={`${styles.planBtn} ${regLoading ? styles.btnLoading : ''}`}
                      onClick={doRegisterFree}
                      disabled={regLoading}
                    >
                      {regLoading ? <span className={styles.spinner} /> : 'Create Free Account'}
                    </button>
                  </div>

                  {/* FAMILY — highlighted */}
                  <div className={`${styles.planCard} ${styles.planCardFeatured}`}>
                    <div className={styles.planBadge}>Most Popular</div>
                    <div className={styles.planName}>Family</div>
                    <div className={styles.planPrice}>
                      <span className={styles.planCurrency}>₹</span>299
                      <span className={styles.planPer}>/month</span>
                    </div>
                    <ul className={styles.planFeatures}>
                      <li>Up to 6 family members</li>
                      <li>Geofence alerts</li>
                      <li>Location history 30 days</li>
                      <li>Priority support</li>
                    </ul>
                    <button
                      className={`${styles.planBtn} ${styles.planBtnPrimary} ${regLoading ? styles.btnLoading : ''}`}
                      onClick={() => doRegisterPaid('family')}
                      disabled={regLoading}
                    >
                      {regLoading ? <span className={styles.spinner} /> : 'Pay ₹299 & Create Account'}
                    </button>
                  </div>

                  {/* PREMIUM */}
                  <div className={styles.planCard}>
                    <div className={styles.planName}>Premium</div>
                    <div className={styles.planPrice}>
                      <span className={styles.planCurrency}>₹</span>499
                      <span className={styles.planPer}>/month</span>
                    </div>
                    <ul className={styles.planFeatures}>
                      <li>Unlimited members</li>
                      <li>Advanced analytics</li>
                      <li>Location history 90 days</li>
                      <li>24/7 dedicated support</li>
                    </ul>
                    <button
                      className={`${styles.planBtn} ${regLoading ? styles.btnLoading : ''}`}
                      onClick={() => doRegisterPaid('premium')}
                      disabled={regLoading}
                    >
                      {regLoading ? <span className={styles.spinner} /> : 'Pay ₹499 & Create Account'}
                    </button>
                  </div>

                </div>

                <button
                  type="button"
                  className={styles.backBtn}
                  onClick={() => { setRegStep(3); setRegError('') }}
                >
                  ← Back to details
                </button>
              </div>
            )}

            <div className={styles.formFooter}>
              Already have an account?{' '}
              <button type="button" className={styles.switchTabBtn} onClick={() => switchTab('login')}>
                Sign in
              </button>
            </div>
          </div>
          {/* /REGISTER PANEL */}

        </div>
        {/* /AUTH CARD */}

        <Link to="/" className={styles.backHome}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back to home
        </Link>

      </div>
    </div>
  )
}
