import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './AdminPanel.module.css';

const AdminLogin: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      // Verify token is still valid
      const apiBase = `${window.location.origin}/api/v1`;
      fetch(`${apiBase}/admin/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (res.ok) {
            navigate('/admin/panel', { replace: true });
          } else {
            localStorage.removeItem('admin_token');
          }
        })
        .catch(() => {
          localStorage.removeItem('admin_token');
        });
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter the admin password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const apiBase = `${window.location.origin}/api/v1`;
      const res = await fetch(`${apiBase}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? 'Invalid password.');
      }

      const data = (await res.json()) as { token: string; admin: boolean };

      if (!data.token || !data.admin) {
        throw new Error('Unexpected response from server.');
      }

      localStorage.setItem('admin_token', data.token);
      navigate('/admin/panel', { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginRoot}>
      {/* Animated background orbs */}
      <div className={`${styles.bgOrb} ${styles.bgOrb1}`} />
      <div className={`${styles.bgOrb} ${styles.bgOrb2}`} />

      <div className={styles.loginCard}>
        {/* Logo / Branding */}
        <div className={styles.loginLogo}>
          <div className={styles.loginLogoMark}>G</div>
          <div className={styles.loginLogoText}>GRAVITY</div>
          <div className={styles.loginLogoSub}>ADMIN PANEL</div>
        </div>

        {/* Login Form */}
        <form className={styles.loginForm} onSubmit={handleLogin} noValidate>
          <input
            className={styles.loginInput}
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setPassword(e.target.value);
              if (error) setError('');
            }}
            autoComplete="current-password"
            disabled={loading}
            aria-label="Admin password"
          />

          <button
            className={styles.loginBtn}
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Verifying...' : 'Access Admin Panel'}
          </button>
        </form>

        {/* Error message */}
        {error && (
          <div className={styles.loginErr} role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminLogin;
