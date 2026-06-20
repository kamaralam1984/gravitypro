import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#071a0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Inter, sans-serif', textAlign: 'center', padding: '2rem' }}>
      <div style={{ fontSize: '5rem', marginBottom: '1rem' }}>📍</div>
      <h1 style={{ fontSize: '6rem', fontWeight: 800, color: '#00E676', margin: 0, lineHeight: 1 }}>404</h1>
      <p style={{ fontSize: '1.3rem', color: 'rgba(255,255,255,0.7)', margin: '1rem 0 0.5rem' }}>Page not found</p>
      <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.4)', marginBottom: '2.5rem', maxWidth: 380 }}>The page you are looking for doesn&apos;t exist or has been moved.</p>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/" style={{ background: '#00E676', color: '#071a0f', padding: '0.75rem 1.75rem', borderRadius: 10, fontWeight: 700, textDecoration: 'none', fontSize: '0.95rem' }}>← Back to Home</Link>
        <Link to="/login" style={{ background: 'rgba(255,255,255,0.07)', color: '#fff', padding: '0.75rem 1.75rem', borderRadius: 10, fontWeight: 600, textDecoration: 'none', fontSize: '0.95rem', border: '1px solid rgba(255,255,255,0.12)' }}>Sign In</Link>
      </div>
    </div>
  )
}
