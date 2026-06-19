import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPanel.module.css'

const AdminLogin: React.FC = () => {
  const navigate = useNavigate()
  const [password, setPassword] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [checking, setChecking] = useState<boolean>(true)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check existing token using x-admin-token header
  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    if (!token) {
      setChecking(false)
      inputRef.current?.focus()
      return
    }
    const apiBase = `${window.location.origin}/api/v1`
    fetch(`${apiBase}/admin/dashboard`, {
      headers: { 'x-admin-token': token },
    })
      .then((res) => {
        if (res.ok) {
          navigate('/admin/panel', { replace: true })
        } else {
          localStorage.removeItem('admin_token')
          setChecking(false)
          inputRef.current?.focus()
        }
      })
      .catch(() => {
        localStorage.removeItem('admin_token')
        setChecking(false)
        inputRef.current?.focus()
      })
  }, [navigate])

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter the admin password.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const apiBase = `${window.location.origin}/api/v1`
      const res = await fetch(`${apiBase}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { message?: string }
        throw new Error(data.message ?? 'Invalid password.')
      }

      const data = (await res.json()) as { token: string; admin: boolean }

      if (!data.token || !data.admin) {
        throw new Error('Unexpected response from server.')
      }

      localStorage.setItem('admin_token', data.token)
      navigate('/admin/panel', { replace: true })
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Login failed. Please try again.'
      setError(message)
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className={styles.loginRoot}>
        <div className={`${styles.bgOrb} ${styles.bgOrb1}`} />
        <div className={`${styles.bgOrb} ${styles.bgOrb2}`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#2D4D35', fontSize: '14px' }}>
          <div className={styles.spinner} />
          Verifying session...
        </div>
      </div>
    )
  }

  return (
    <div className={styles.loginRoot}>
      {/* Animated background orbs */}
      <div className={`${styles.bgOrb} ${styles.bgOrb1}`} />
      <div className={`${styles.bgOrb} ${styles.bgOrb2}`} />
      <div className={`${styles.bgOrb} ${styles.bgOrb3}`} />

      <div className={styles.loginCard}>
        {/* Logo */}
        <div className={styles.loginLogo}>
          <div className={styles.loginShield} aria-hidden="true">
            <svg className={styles.loginShieldSvg} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1zm-2 15l-3-3 1.41-1.41L10 13.17l5.59-5.58L17 9l-7 7z"/>
            </svg>
          </div>
          <div className={styles.loginLogoTitle}>GRAVITY</div>
          <div className={styles.loginLogoSub}>Admin Panel</div>
        </div>

        {/* Form */}
        <form className={styles.loginForm} onSubmit={handleLogin} noValidate>
          <div className={styles.loginInputWrap}>
            <input
              ref={inputRef}
              className={styles.loginInput}
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
              autoComplete="current-password"
              disabled={loading}
              aria-label="Admin password"
              aria-describedby={error ? 'login-error' : undefined}
            />
            {/* Lock icon overlay */}
            <svg
              className={styles.loginLockIcon}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>

          <button
            className={styles.loginBtn}
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Verifying...' : 'Access Admin Panel'}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div id="login-error" className={styles.loginErr} role="alert">
            <svg className={styles.loginErrIcon} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminLogin
