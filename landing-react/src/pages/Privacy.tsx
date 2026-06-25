import React from 'react'
import { Link } from 'react-router-dom'

const S = {
  root: { minHeight: '100vh', background: '#071a0f', color: '#fff', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  nav:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2rem', borderBottom: '1px solid rgba(0,230,118,0.12)', background: 'rgba(7,26,15,0.95)' } as React.CSSProperties,
  body: { maxWidth: 780, margin: '0 auto', padding: '3rem 1.5rem 4rem' } as React.CSSProperties,
  h1:   { fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 800, marginBottom: '0.5rem' } as React.CSSProperties,
  date: { color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', marginBottom: '2.5rem' } as React.CSSProperties,
  h2:   { fontSize: '1.15rem', fontWeight: 700, color: '#00E676', marginTop: '2rem', marginBottom: '0.5rem' } as React.CSSProperties,
  p:    { color: 'rgba(255,255,255,0.72)', lineHeight: 1.75, fontSize: '0.95rem', marginBottom: '0.75rem' } as React.CSSProperties,
  ul:   { color: 'rgba(255,255,255,0.72)', lineHeight: 2, fontSize: '0.95rem', paddingLeft: '1.5rem', marginBottom: '0.75rem' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: '1rem' } as React.CSSProperties,
  th:   { background: 'rgba(0,230,118,0.08)', color: '#00E676', padding: '0.6rem 0.85rem', textAlign: 'left' as const, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.1)' } as React.CSSProperties,
  td:   { padding: '0.6rem 0.85rem', fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.06)' } as React.CSSProperties,
}

export default function Privacy() {
  return (
    <div style={S.root}>
      <nav style={S.nav}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <span style={{ fontSize: '1.3rem' }}>📍</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#00E676', letterSpacing: 2 }}>GRAVITY</span>
        </Link>
        <Link to="/" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none', fontSize: '0.88rem' }}>← Home</Link>
      </nav>

      <div style={S.body}>
        <h1 style={S.h1}>Privacy Policy</h1>
        <p style={S.date}>Last updated: June 2026 · Trackalways Limited</p>

        <p style={S.p}>This Privacy Policy explains how Trackalways Limited ("we", "us", "Gravity") collects, uses, and protects your personal information when you use the Gravity Family Safety app and website.</p>

        <h2 style={S.h2}>1. Data We Collect</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Data Type</th>
              <th style={S.th}>Purpose</th>
              <th style={S.th}>Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={S.td}>Phone number</td><td style={S.td}>Account identity & OTP verification</td><td style={S.td}>Until account deleted</td></tr>
            <tr><td style={S.td}>Name, email</td><td style={S.td}>Profile display, notifications</td><td style={S.td}>Until account deleted</td></tr>
            <tr><td style={S.td}>Location (GPS)</td><td style={S.td}>Real-time sharing with your family circle</td><td style={S.td}>30 days</td></tr>
            <tr><td style={S.td}>Device token</td><td style={S.td}>Push notifications (SOS, geofence alerts)</td><td style={S.td}>Until logout or account deleted</td></tr>
            <tr><td style={S.td}>Battery level</td><td style={S.td}>Shared with family circle (optional)</td><td style={S.td}>Latest value only</td></tr>
          </tbody>
        </table>

        <h2 style={S.h2}>2. Location Data — How It Works</h2>
        <p style={S.p}>Location data is only shared with members of your family circles. You explicitly choose who is in your circle. All location data is encrypted in transit (TLS 1.3) and at rest (AES-256). We use PostGIS on Neon PostgreSQL for storage. Location accuracy depends on device GPS, not Gravity.</p>
        <p style={S.p}>We do NOT:</p>
        <ul style={S.ul}>
          <li>Sell your location data to advertisers</li>
          <li>Share your location with any third party without your consent</li>
          <li>Use your location data for profiling or targeting</li>
          <li>Retain location history beyond the retention limit</li>
        </ul>

        <h2 style={S.h2}>3. How We Use Your Data</h2>
        <ul style={S.ul}>
          <li>Provide real-time location sharing within your family circle</li>
          <li>Send geofence entry/exit alerts to circle members</li>
          <li>Deliver SOS emergency notifications</li>
          <li>Send OTP codes for authentication</li>
          <li>Improve service reliability and fix bugs (aggregated, anonymised analytics only)</li>
        </ul>

        <h2 style={S.h2}>4. Data Sharing</h2>
        <p style={S.p}>We share your data only with:</p>
        <ul style={S.ul}>
          <li><strong style={{ color: '#fff' }}>SMS providers</strong> — for OTP delivery</li>
          <li><strong style={{ color: '#fff' }}>Cloud infrastructure</strong> — Neon (database), Cloudflare R2 (media), our VPS (API)</li>
          <li><strong style={{ color: '#fff' }}>Your family circle members</strong> — location, name, avatar, battery level as you've consented to share</li>
        </ul>
        <p style={S.p}>We never sell your data. We will disclose data to law enforcement only if legally required by a valid court order.</p>

        <h2 style={S.h2}>5. Children's Privacy</h2>
        <p style={S.p}>Gravity is designed to help parents keep children safe. Children's accounts must be created with explicit parental consent. We do not knowingly collect data from children under 13 without verified parental consent. If you believe a child under 13 has an account without parental consent, contact us immediately.</p>

        <h2 style={S.h2}>6. Your Rights</h2>
        <p style={S.p}>You have the right to:</p>
        <ul style={S.ul}>
          <li><strong style={{ color: '#fff' }}>Access</strong> — Download all data we hold about you</li>
          <li><strong style={{ color: '#fff' }}>Correct</strong> — Update your name, email, or phone number from account settings</li>
          <li><strong style={{ color: '#fff' }}>Delete</strong> — Delete your account and all associated data from account settings</li>
          <li><strong style={{ color: '#fff' }}>Portability</strong> — Export your location history in JSON format</li>
          <li><strong style={{ color: '#fff' }}>Withdraw consent</strong> — Leave any family circle at any time; stop location sharing immediately</li>
          <li><strong style={{ color: '#fff' }}>Opt out</strong> — Disable push notifications from device settings</li>
        </ul>

        <h2 style={S.h2}>7. Security</h2>
        <p style={S.p}>We use industry-standard security measures: TLS 1.3 encryption for all data in transit, AES-256 encryption at rest, JWT authentication with short-lived tokens, rate limiting on all API endpoints, and regular security reviews. Despite these measures, no system is 100% secure. Report any security vulnerability to security@trackalways.com.</p>

        <h2 style={S.h2}>8. Cookies & Analytics</h2>
        <p style={S.p}>Our website uses minimal cookies for session management only. We do not use third-party tracking cookies or advertising pixels. We use anonymised server logs to monitor performance and security.</p>

        <h2 style={S.h2}>9. Changes to This Policy</h2>
        <p style={S.p}>We may update this policy. Material changes will be notified via the app or email. Continued use after changes constitutes acceptance.</p>

        <h2 style={S.h2}>10. Contact Us</h2>
        <p style={S.p}>Data Controller: Trackalways Limited<br />
        Email: <span style={{ color: '#00E676' }}>privacy@trackalways.com</span><br />
        For GDPR/data requests: Include "Data Request" in the subject line.</p>

        <div style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Link to="/terms" style={{ color: '#00E676', textDecoration: 'none', fontSize: '0.9rem' }}>Terms of Service →</Link>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.45)', textDecoration: 'none', fontSize: '0.9rem' }}>← Back to Home</Link>
        </div>
      </div>
    </div>
  )
}
