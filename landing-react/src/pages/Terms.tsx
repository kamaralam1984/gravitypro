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
}

import React from 'react'

export default function Terms() {
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
        <h1 style={S.h1}>Terms of Service</h1>
        <p style={S.date}>Last updated: June 2026 · Trackalways Limited</p>

        <h2 style={S.h2}>1. Acceptance of Terms</h2>
        <p style={S.p}>By downloading, installing, or using Gravity Family Safety ("the App") or visiting gravitypro.kvlbusinesssolutions.com ("the Website"), you agree to be bound by these Terms of Service. If you do not agree, do not use our services.</p>

        <h2 style={S.h2}>2. Description of Service</h2>
        <p style={S.p}>Gravity is a family safety platform that provides real-time location sharing, geofence alerts, SOS emergency features, and family circle management. The service is intended for use by families and individuals who have given mutual consent to share their location data.</p>

        <h2 style={S.h2}>3. User Accounts</h2>
        <p style={S.p}>To use Gravity, you must create an account using a valid phone number. You are responsible for maintaining the confidentiality of your account credentials. You must be at least 13 years old to create an account. Users under 18 must have parental consent.</p>

        <h2 style={S.h2}>4. Consent and Location Sharing</h2>
        <p style={S.p}>Location sharing requires explicit consent from all participants. You must obtain consent before adding any person to your family circle. Gravity does not enable covert tracking — all members in a circle are aware they are being tracked. You may leave any circle at any time.</p>

        <h2 style={S.h2}>5. Prohibited Uses</h2>
        <ul style={S.ul}>
          <li>Tracking any person without their explicit knowledge and consent</li>
          <li>Using the service for stalking, harassment, or surveillance</li>
          <li>Sharing access credentials with unauthorized parties</li>
          <li>Attempting to reverse-engineer, copy, or exploit the platform</li>
          <li>Using automated scripts or bots to access the service</li>
        </ul>

        <h2 style={S.h2}>6. Subscription and Payments</h2>
        <p style={S.p}>Free plan features are available at no cost. Paid plans (Family, Premium) are billed monthly. You may cancel at any time and access continues until the end of the billing period. Refunds are available within 7 days of purchase by contacting support. We accept Razorpay, M-Pesa, Pesapal, Stripe, and PayPal.</p>

        <h2 style={S.h2}>7. Data and Privacy</h2>
        <p style={S.p}>Your location data is encrypted in transit and at rest. We do not sell your personal data to third parties. Location history is retained based on your plan (24 hours for Free, up to 30 days for Premium). See our <Link to="/privacy" style={{ color: '#00E676' }}>Privacy Policy</Link> for full details.</p>

        <h2 style={S.h2}>8. SOS and Emergency Features</h2>
        <p style={S.p}>The SOS feature is provided as a convenience tool. Gravity is not an emergency service. In a genuine emergency, always call local emergency services (112, 911, 999, etc.) first. Gravity makes no guarantee of delivery time for SOS notifications.</p>

        <h2 style={S.h2}>9. Limitation of Liability</h2>
        <p style={S.p}>Gravity is provided "as is." We are not liable for any indirect, incidental, or consequential damages arising from your use of the service, including but not limited to loss of data, location inaccuracies, missed alerts, or service interruptions.</p>

        <h2 style={S.h2}>10. Termination</h2>
        <p style={S.p}>We reserve the right to suspend or terminate accounts that violate these terms. You may delete your account at any time from account settings, which will permanently remove your data.</p>

        <h2 style={S.h2}>11. Changes to Terms</h2>
        <p style={S.p}>We may update these terms from time to time. Continued use of the service after changes constitutes acceptance. We will notify you of material changes via the app or email.</p>

        <h2 style={S.h2}>12. Contact</h2>
        <p style={S.p}>For questions about these terms, contact us at: <span style={{ color: '#00E676' }}>support@trackalways.com</span></p>

        <div style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Link to="/privacy" style={{ color: '#00E676', textDecoration: 'none', fontSize: '0.9rem' }}>Privacy Policy →</Link>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.45)', textDecoration: 'none', fontSize: '0.9rem' }}>← Back to Home</Link>
        </div>
      </div>
    </div>
  )
}
