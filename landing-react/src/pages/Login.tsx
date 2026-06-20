import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import styles from './Login.module.css'

const API = window.location.origin + '/api/v1'

function validatePhone(phone: string): boolean {
  const clean = phone.replace(/[\s\-().]/g, '')
  return clean.length >= 8 && /^[+\d]/.test(clean)
}

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')

  // Login form state
  const [loginPhone, setLoginPhone] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginShowPassword, setLoginShowPassword] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginPhoneError, setLoginPhoneError] = useState(false)
  const [loginPasswordError, setLoginPasswordError] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)

  // Login OTP step state
  const [loginStep, setLoginStep] = useState<1 | 2>(1)
  const [loginOtp, setLoginOtp] = useState('')
  const [loginSendingOtp, setLoginSendingOtp] = useState(false)
  const [devOtpBanner, setDevOtpBanner] = useState('')

  // Register form state
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regCountry, setRegCountry] = useState('IN')
  const [regShowPassword, setRegShowPassword] = useState(false)
  const [registerError, setRegisterError] = useState('')
  const [registerSuccess, setRegisterSuccess] = useState(false)
  const [regNameError, setRegNameError] = useState(false)
  const [regPhoneError, setRegPhoneError] = useState(false)
  const [regEmailError, setRegEmailError] = useState(false)
  const [regPasswordError, setRegPasswordError] = useState(false)
  const [registerLoading, setRegisterLoading] = useState(false)

  // Register OTP step state
  const [regStep, setRegStep] = useState<1 | 2>(1)
  const [regOtp, setRegOtp] = useState('')
  const [regSendingOtp, setRegSendingOtp] = useState(false)
  const [regDevOtpBanner, setRegDevOtpBanner] = useState('')

  // Role selector
  const [accountType, setAccountType] = useState<'parent' | 'child'>('parent')

  // Google fallback visibility
  const [showGoogleFallback, setShowGoogleFallback] = useState(false)
  const [googleLoginLoading, setGoogleLoginLoading] = useState(false)
  const [googleRegisterLoading, setGoogleRegisterLoading] = useState(false)

  const GOOGLE_CLIENT_ID = localStorage.getItem('gravity_google_client_id') || ''
  const hasGoogleClientId = GOOGLE_CLIENT_ID.length > 20

  // Load Google GSI script only when client ID is configured
  useEffect(() => {
    if (!hasGoogleClientId) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    document.head.appendChild(script)
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script)
    }
  }, [hasGoogleClientId])

  // Check if already logged in
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
          if (dest) {
            navigate(dest)
          } else {
            const storedUser = JSON.parse(localStorage.getItem('gravity_user') || 'null')
            navigate(storedUser?.account_type === 'child' ? '/child/panel' : '/parent/panel')
          }
        }
      } catch {
        localStorage.removeItem('gravity_token')
        localStorage.removeItem('gravity_user')
      }
    }
  }, [searchParams])

  // Auto-detect tab from URL hash
  useEffect(() => {
    if (window.location.hash === '#register') {
      setActiveTab('register')
    }
  }, [])

  // Show fallback Google buttons if GSI doesn't render within 2s
  useEffect(() => {
    const timer = setTimeout(() => {
      const gButtons = document.querySelectorAll('.g_id_signin')
      gButtons.forEach((btn) => {
        const rendered = btn.querySelector('iframe')
        if (!rendered) {
          setShowGoogleFallback(true)
        }
      })
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // Expose handleGoogleCredential to window for GSI callback
  useEffect(() => {
    const win = window as Window & typeof globalThis & {
      handleGoogleCredential?: (r: { credential: string }) => void
    }
    win.handleGoogleCredential = async (response: { credential: string }) => {
      try {
        const res = await fetch(API + '/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_token: response.credential, account_type: accountType }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Google login failed')
        onLoginSuccess(data)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Google login failed'
        setLoginError(msg)
        setRegisterError(msg)
      }
    }
    return () => {
      delete win.handleGoogleCredential
    }
  }, [])

  function onLoginSuccess(data: { token: string; user: Record<string, string> }) {
    localStorage.setItem('gravity_token', data.token)
    localStorage.setItem('gravity_user', JSON.stringify(data.user))
    const urlRedirect = searchParams.get('redirect')
    const savedRedirect = localStorage.getItem('gravity_redirect')
    localStorage.removeItem('gravity_redirect')
    const dest = urlRedirect || savedRedirect
    if (dest) {
      navigate(dest)
    } else {
      const type = data.user?.account_type || accountType
      navigate(type === 'child' ? '/child/panel' : '/parent/panel')
    }
  }

  function switchTab(tab: 'login' | 'register') {
    setActiveTab(tab)
    setLoginError('')
    setRegisterError('')
    setLoginPhoneError(false)
    setLoginPasswordError(false)
    setRegNameError(false)
    setRegPhoneError(false)
    setRegEmailError(false)
    setRegPasswordError(false)
    // Reset login OTP step
    setLoginStep(1)
    setLoginOtp('')
    setDevOtpBanner('')
    // Reset register OTP step
    setRegStep(1)
    setRegOtp('')
    setRegDevOtpBanner('')
  }

  async function doLoginSendOtp() {
    setLoginError('')
    setLoginPhoneError(false)

    const phone = loginPhone.trim()
    if (!phone) {
      setLoginPhoneError(true)
      setLoginError('Please enter your phone number.')
      return
    }
    if (!validatePhone(phone)) {
      setLoginPhoneError(true)
      setLoginError('Please enter a valid phone number.')
      return
    }

    setLoginSendingOtp(true)
    try {
      const res = await fetch(API + '/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      if (data.dev_otp) {
        setLoginOtp(String(data.dev_otp))
        setDevOtpBanner(String(data.dev_otp))
      }
      setLoginStep(2)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send OTP'
      setLoginError(msg)
      setLoginPhoneError(true)
    } finally {
      setLoginSendingOtp(false)
    }
  }

  async function doLoginSubmit() {
    setLoginError('')
    setLoginPasswordError(false)

    const phone = loginPhone.trim()
    const password = loginPassword
    const otp = loginOtp.trim()

    if (!otp || otp.length < 6) {
      setLoginError('Please enter the 6-digit OTP.')
      return
    }
    if (!password) {
      setLoginPasswordError(true)
      setLoginError('Please enter your password.')
      return
    }

    setLoginLoading(true)
    try {
      const res = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password, otp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      onLoginSuccess(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      setLoginError(msg)
      setLoginPasswordError(true)
    } finally {
      setLoginLoading(false)
    }
  }

  async function doRegSendOtp() {
    setRegisterError('')
    setRegNameError(false)
    setRegPhoneError(false)
    setRegEmailError(false)
    setRegPasswordError(false)

    const name = regName.trim()
    const phone = regPhone.trim()
    const email = regEmail.trim()
    const password = regPassword

    if (!name || name.length < 2) {
      setRegNameError(true)
      setRegisterError('Please enter your full name (at least 2 characters).')
      return
    }
    if (!phone) {
      setRegPhoneError(true)
      setRegisterError('Please enter your phone number.')
      return
    }
    if (!validatePhone(phone)) {
      setRegPhoneError(true)
      setRegisterError('Please enter a valid phone number.')
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegEmailError(true)
      setRegisterError('Please enter a valid email address.')
      return
    }
    if (!password || password.length < 8) {
      setRegPasswordError(true)
      setRegisterError('Password must be at least 8 characters.')
      return
    }

    setRegSendingOtp(true)
    try {
      const res = await fetch(API + '/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      if (data.dev_otp) {
        setRegOtp(String(data.dev_otp))
        setRegDevOtpBanner(String(data.dev_otp))
      }
      setRegStep(2)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send OTP'
      setRegisterError(msg)
      setRegPhoneError(true)
    } finally {
      setRegSendingOtp(false)
    }
  }

  async function doRegisterSubmit() {
    setRegisterError('')

    const name = regName.trim()
    const phone = regPhone.trim()
    const email = regEmail.trim()
    const password = regPassword
    const country_code = regCountry
    const otp = regOtp.trim()

    if (!otp || otp.length < 6) {
      setRegisterError('Please enter the 6-digit OTP.')
      return
    }

    setRegisterLoading(true)
    try {
      const body: Record<string, string> = { name, phone, password, country_code, account_type: accountType, otp }
      if (email) body.email = email
      const res = await fetch(API + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')

      setRegisterSuccess(true)
      setTimeout(() => {
        onLoginSuccess(data)
      }, 1000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed'
      setRegisterError(msg)
    } finally {
      setRegisterLoading(false)
    }
  }

  function triggerGoogleSignIn(setLoading: (v: boolean) => void) {
    setLoading(true)
    const win = window as Window & typeof globalThis & {
      google?: { accounts?: { id?: { prompt?: () => void } } }
    }
    if (win.google?.accounts?.id?.prompt) {
      win.google.accounts.id.prompt()
    } else {
      setLoading(false)
      setLoginError('Google Sign-In is not available. Please use phone/password.')
    }
  }

  return (
    <div
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflowX: 'hidden',
        WebkitFontSmoothing: 'antialiased',
        padding: '24px 16px 48px',
        backgroundImage: [
          'radial-gradient(ellipse 900px 600px at 50% -100px, rgba(0,230,118,0.07) 0%, transparent 70%)',
          'radial-gradient(ellipse 600px 600px at 80% 80%, rgba(0,200,83,0.04) 0%, transparent 60%)',
          'repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(0,230,118,0.022) 39px, rgba(0,230,118,0.022) 40px)',
          'repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(0,230,118,0.022) 39px, rgba(0,230,118,0.022) 40px)',
        ].join(', '),
      }}
    >
      <div className={styles.pageWrap}>

        {/* LOGO */}
        <Link to="/" className={styles.logoArea}>
          <div className={styles.logoMark}>
            <svg width="52" height="56" viewBox="0 0 52 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M26 2C15.507 2 7 10.507 7 21C7 35.5 26 54 26 54C26 54 45 35.5 45 21C45 10.507 36.493 2 26 2Z" fill="url(#pin_grad)" stroke="rgba(0,230,118,0.3)" strokeWidth="0.5"/>
              <circle cx="26" cy="21" r="9" fill="#020C05" opacity="0.8"/>
              <circle cx="26" cy="21" r="4.5" fill="url(#dot_grad)"/>
              <circle cx="26" cy="21" r="13" stroke="rgba(0,230,118,0.2)" strokeWidth="1.5" fill="none"/>
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
          <div>
            <div className={styles.logoText}>Gravity</div>
            <div className={styles.logoSub}>Family Safety</div>
          </div>
        </Link>

        {/* Google one-tap init — rendered once */}
        {hasGoogleClientId && (
          <div
            id="g_id_onload"
            data-client_id={GOOGLE_CLIENT_ID}
            data-callback="handleGoogleCredential"
            data-auto_prompt="false"
          ></div>
        )}

        {/* AUTH CARD */}
        <div className={styles.authCard}>

          {/* TAB BAR */}
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBtn}${activeTab === 'login' ? ' ' + styles.active : ''}`}
              onClick={() => switchTab('login')}
            >
              Sign In
            </button>
            <button
              className={`${styles.tabBtn}${activeTab === 'register' ? ' ' + styles.active : ''}`}
              onClick={() => switchTab('register')}
            >
              Create Account
            </button>
            <div className={`${styles.tabIndicator}${activeTab === 'register' ? ' ' + styles.register : ''}`}></div>
          </div>

          {/* ===== LOGIN PANEL ===== */}
          <div className={`${styles.formPanel}${activeTab === 'login' ? ' ' + styles.active : ''}`}>
          <form onSubmit={(e) => { e.preventDefault(); loginStep === 1 ? doLoginSendOtp() : doLoginSubmit() }} autoComplete="on">

            <div className={styles.panelHeading}>
              <h2>Welcome back</h2>
              <p>Sign in to keep your family connected</p>
            </div>

            {/* Google Sign-In — only shown when client ID is configured */}
            {hasGoogleClientId && loginStep === 1 && (
              <div className={styles.googleBtnWrap}>
                <div
                  className="g_id_signin"
                  data-type="standard"
                  data-theme="filled_black"
                  data-text="signin_with"
                  data-shape="rectangular"
                  data-logo_alignment="left"
                  data-width="384"
                ></div>
                {showGoogleFallback && (
                  <button
                    className={`${styles.googleBtn}${googleLoginLoading ? ' ' + styles.loading : ''}`}
                    onClick={() => triggerGoogleSignIn(setGoogleLoginLoading)}
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                  </button>
                )}
              </div>
            )}

            {/* Divider — only shown when Google is available */}
            {hasGoogleClientId && loginStep === 1 && (
              <div className={styles.divider}>
                <div className={styles.dividerLine}></div>
                <span className={styles.dividerText}>OR</span>
                <div className={styles.dividerLine}></div>
              </div>
            )}

            {/* Role Selector — step 1 only */}
            {loginStep === 1 && (
              <div className={styles.roleSelector}>
                <button
                  type="button"
                  className={`${styles.roleBtn} ${accountType === 'parent' ? styles.roleActive : ''}`}
                  onClick={() => setAccountType('parent')}
                >
                  <span className={styles.roleIcon}>👨‍👩‍👧</span>
                  <span>I'm a Parent</span>
                </button>
                <button
                  type="button"
                  className={`${styles.roleBtn} ${accountType === 'child' ? styles.roleActive : ''}`}
                  onClick={() => setAccountType('child')}
                >
                  <span className={styles.roleIcon}>👦</span>
                  <span>I'm a Child</span>
                </button>
              </div>
            )}

            {/* Error message */}
            <div className={`${styles.errorMsg}${loginError ? ' ' + styles.visible : ''}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{loginError}</span>
            </div>

            {/* ---- STEP 1: Phone + Send OTP ---- */}
            {loginStep === 1 && (
              <>
                {/* Phone field */}
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
                      className={`${styles.fieldInput}${loginPhoneError ? ' ' + styles.error : ''}`}
                      id="login-phone"
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                      inputMode="tel"
                      value={loginPhone}
                      onChange={(e) => { setLoginPhone(e.target.value); setLoginError(''); setLoginPhoneError(false) }}
                    />
                  </div>
                </div>

                {/* Send OTP button */}
                <button
                  className={`${styles.btnPrimary}${loginSendingOtp ? ' ' + styles.loading : ''}`}
                  type="submit"
                  disabled={loginSendingOtp}
                >
                  <div className={styles.spinner}></div>
                  <span className={styles.btnText}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                    </svg>
                    Send OTP
                  </span>
                </button>
              </>
            )}

            {/* ---- STEP 2: OTP + Password + Sign In ---- */}
            {loginStep === 2 && (
              <>
                {/* Dev OTP banner */}
                {devOtpBanner && (
                  <div style={{
                    background: 'rgba(255,183,0,0.1)',
                    border: '1px solid rgba(255,183,0,0.3)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    marginBottom: 14,
                    fontSize: 12,
                    color: '#FFB300',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    🔧 Dev mode — OTP: <span style={{ fontFamily: 'monospace', fontSize: 16, color: '#FFD54F' }}>{devOtpBanner}</span>
                  </div>
                )}

                {/* OTP input */}
                <div style={{
                  background: '#111E16',
                  border: '2px solid rgba(0,230,118,0.3)',
                  borderRadius: 14,
                  padding: '16px',
                  textAlign: 'center',
                  marginBottom: 16
                }}>
                  <div style={{ fontSize: 12, color: '#5E8B6E', marginBottom: 8, letterSpacing: 1 }}>
                    ENTER 6-DIGIT OTP
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={loginOtp}
                    onChange={e => setLoginOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#00E676',
                      fontSize: 32,
                      fontWeight: 900,
                      letterSpacing: 8,
                      textAlign: 'center',
                      width: '100%',
                      fontFamily: 'monospace'
                    }}
                    placeholder="──────"
                    autoFocus
                  />
                </div>

                {/* Password field */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="login-password">Password</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                      </svg>
                    </span>
                    <input
                      type={loginShowPassword ? 'text' : 'password'}
                      className={`${styles.fieldInput} ${styles.hasSuffix}${loginPasswordError ? ' ' + styles.error : ''}`}
                      id="login-password"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => { setLoginPassword(e.target.value); setLoginError(''); setLoginPasswordError(false) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') doLoginSubmit() }}
                    />
                    <span className={styles.fieldSuffix}>
                      <button
                        className={styles.eyeBtn}
                        onClick={() => setLoginShowPassword(!loginShowPassword)}
                        type="button"
                        aria-label="Toggle password visibility"
                      >
                        {!loginShowPassword ? (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        ) : (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        )}
                      </button>
                    </span>
                  </div>
                </div>

                {/* Sign In button */}
                <button
                  className={`${styles.btnPrimary}${loginLoading ? ' ' + styles.loading : ''}`}
                  type="submit"
                  disabled={loginLoading}
                >
                  <div className={styles.spinner}></div>
                  <span className={styles.btnText}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
                      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                    </svg>
                    Sign In
                  </span>
                </button>

                {/* Resend OTP */}
                <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, color: '#5E8B6E' }}>
                  Didn&apos;t receive the OTP?{' '}
                  <a
                    href="#"
                    style={{ color: '#00E676', textDecoration: 'none', fontWeight: 600 }}
                    onClick={(e) => {
                      e.preventDefault()
                      setLoginStep(1)
                      setLoginOtp('')
                      setDevOtpBanner('')
                      setLoginError('')
                    }}
                  >
                    Resend OTP
                  </a>
                </div>
              </>
            )}

            <div className={styles.formFooter}>
              Don&apos;t have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); switchTab('register') }}>Create one free</a>
            </div>

          </form>
          </div>
          {/* /LOGIN PANEL */}

          {/* ===== REGISTER PANEL ===== */}
          <div className={`${styles.formPanel}${activeTab === 'register' ? ' ' + styles.active : ''}`}>
          <form onSubmit={(e) => { e.preventDefault(); regStep === 1 ? doRegSendOtp() : doRegisterSubmit() }} autoComplete="on">

            <div className={styles.panelHeading}>
              <h2>Create your account</h2>
              <p>Join thousands of families staying connected</p>
            </div>

            {/* Google Sign-Up — only when client ID configured, step 1 only */}
            {hasGoogleClientId && regStep === 1 && (
              <div className={styles.googleBtnWrap}>
                <div
                  className="g_id_signin"
                  data-type="standard"
                  data-theme="filled_black"
                  data-text="signup_with"
                  data-shape="rectangular"
                  data-logo_alignment="left"
                  data-width="384"
                ></div>
                {showGoogleFallback && (
                  <button
                    className={`${styles.googleBtn}${googleRegisterLoading ? ' ' + styles.loading : ''}`}
                    onClick={() => triggerGoogleSignIn(setGoogleRegisterLoading)}
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                  </button>
                )}
              </div>
            )}
            {hasGoogleClientId && regStep === 1 && (
              <div className={styles.divider}>
                <div className={styles.dividerLine}></div>
                <span className={styles.dividerText}>OR</span>
                <div className={styles.dividerLine}></div>
              </div>
            )}

            {/* Error message */}
            <div className={`${styles.errorMsg}${registerError ? ' ' + styles.visible : ''}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{registerError}</span>
            </div>

            {/* Success message */}
            <div className={`${styles.successMsg}${registerSuccess ? ' ' + styles.visible : ''}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Account created! Signing you in...</span>
            </div>

            {/* ---- REGISTER STEP 1: Full form ---- */}
            {regStep === 1 && (
              <>
                {/* Role Selector */}
                <div className={styles.roleSelector}>
                  <button
                    type="button"
                    className={`${styles.roleBtn} ${accountType === 'parent' ? styles.roleActive : ''}`}
                    onClick={() => setAccountType('parent')}
                  >
                    <span className={styles.roleIcon}>👨‍👩‍👧</span>
                    <span>I'm a Parent</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.roleBtn} ${accountType === 'child' ? styles.roleActive : ''}`}
                    onClick={() => setAccountType('child')}
                  >
                    <span className={styles.roleIcon}>👦</span>
                    <span>I'm a Child</span>
                  </button>
                </div>

                {/* Full Name */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-name">Full Name</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <input
                      type="text"
                      className={`${styles.fieldInput}${regNameError ? ' ' + styles.error : ''}`}
                      id="reg-name"
                      placeholder="Priya Sharma"
                      autoComplete="name"
                      value={regName}
                      onChange={(e) => { setRegName(e.target.value); setRegisterError(''); setRegNameError(false) }}
                    />
                  </div>
                </div>

                {/* Phone */}
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
                      className={`${styles.fieldInput}${regPhoneError ? ' ' + styles.error : ''}`}
                      id="reg-phone"
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                      inputMode="tel"
                      value={regPhone}
                      onChange={(e) => { setRegPhone(e.target.value); setRegisterError(''); setRegPhoneError(false) }}
                    />
                  </div>
                </div>

                {/* Email (optional) */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-email">
                    Email Address <span className={styles.optionalBadge}>Optional</span>
                  </label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </span>
                    <input
                      type="email"
                      className={`${styles.fieldInput}${regEmailError ? ' ' + styles.error : ''}`}
                      id="reg-email"
                      placeholder="priya@example.com"
                      autoComplete="email"
                      inputMode="email"
                      value={regEmail}
                      onChange={(e) => { setRegEmail(e.target.value); setRegisterError(''); setRegEmailError(false) }}
                    />
                  </div>
                </div>

                {/* Password */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-password">Password</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                      </svg>
                    </span>
                    <input
                      type={regShowPassword ? 'text' : 'password'}
                      className={`${styles.fieldInput} ${styles.hasSuffix}${regPasswordError ? ' ' + styles.error : ''}`}
                      id="reg-password"
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      value={regPassword}
                      onChange={(e) => { setRegPassword(e.target.value); setRegisterError(''); setRegPasswordError(false) }}
                    />
                    <span className={styles.fieldSuffix}>
                      <button
                        className={styles.eyeBtn}
                        onClick={() => setRegShowPassword(!regShowPassword)}
                        type="button"
                        aria-label="Toggle password visibility"
                      >
                        {!regShowPassword ? (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        ) : (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        )}
                      </button>
                    </span>
                  </div>
                </div>

                {/* Country */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="reg-country">Country</label>
                  <div className={styles.fieldWrap}>
                    <span className={styles.fieldIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                      </svg>
                    </span>
                    <select
                      className={styles.fieldSelect}
                      id="reg-country"
                      value={regCountry}
                      onChange={(e) => setRegCountry(e.target.value)}
                    >
                      <option value="IN">India</option>
                      <option value="PK">Pakistan</option>
                      <option value="AE">UAE</option>
                      <option value="GB">United Kingdom</option>
                      <option value="US">United States</option>
                    </select>
                  </div>
                </div>

                {/* Send OTP button */}
                <button
                  className={`${styles.btnPrimary}${regSendingOtp ? ' ' + styles.loading : ''}`}
                  type="submit"
                  disabled={regSendingOtp}
                >
                  <div className={styles.spinner}></div>
                  <span className={styles.btnText}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                    </svg>
                    Send OTP
                  </span>
                </button>
              </>
            )}

            {/* ---- REGISTER STEP 2: OTP + Create Account ---- */}
            {regStep === 2 && (
              <>
                {/* Dev OTP banner */}
                {regDevOtpBanner && (
                  <div style={{
                    background: 'rgba(255,183,0,0.1)',
                    border: '1px solid rgba(255,183,0,0.3)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    marginBottom: 14,
                    fontSize: 12,
                    color: '#FFB300',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    🔧 Dev mode — OTP: <span style={{ fontFamily: 'monospace', fontSize: 16, color: '#FFD54F' }}>{regDevOtpBanner}</span>
                  </div>
                )}

                {/* OTP input */}
                <div style={{
                  background: '#111E16',
                  border: '2px solid rgba(0,230,118,0.3)',
                  borderRadius: 14,
                  padding: '16px',
                  textAlign: 'center',
                  marginBottom: 16
                }}>
                  <div style={{ fontSize: 12, color: '#5E8B6E', marginBottom: 8, letterSpacing: 1 }}>
                    ENTER 6-DIGIT OTP
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={regOtp}
                    onChange={e => setRegOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#00E676',
                      fontSize: 32,
                      fontWeight: 900,
                      letterSpacing: 8,
                      textAlign: 'center',
                      width: '100%',
                      fontFamily: 'monospace'
                    }}
                    placeholder="──────"
                    autoFocus
                  />
                </div>

                {/* Create Account button */}
                <button
                  className={`${styles.btnPrimary}${registerLoading ? ' ' + styles.loading : ''}`}
                  type="submit"
                  disabled={registerLoading}
                >
                  <div className={styles.spinner}></div>
                  <span className={styles.btnText}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
                      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                    </svg>
                    Create Account
                  </span>
                </button>

                {/* Resend OTP */}
                <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, color: '#5E8B6E' }}>
                  Didn&apos;t receive the OTP?{' '}
                  <a
                    href="#"
                    style={{ color: '#00E676', textDecoration: 'none', fontWeight: 600 }}
                    onClick={(e) => {
                      e.preventDefault()
                      setRegStep(1)
                      setRegOtp('')
                      setRegDevOtpBanner('')
                      setRegisterError('')
                    }}
                  >
                    Resend OTP
                  </a>
                </div>
              </>
            )}

            {regStep === 1 && (
              <div className={styles.termsText}>
                By creating an account you agree to our{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                Your location data is encrypted and never sold.
              </div>
            )}

            <div className={styles.formFooter}>
              Already have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); switchTab('login') }}>Sign in</a>
            </div>

          </form>
          </div>
          {/* /REGISTER PANEL */}

        </div>
        {/* /AUTH CARD */}

        {/* Back link */}
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
