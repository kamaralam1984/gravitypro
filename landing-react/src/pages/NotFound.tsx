import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#071a0f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, sans-serif',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#00E676', marginBottom: '2rem', letterSpacing: '0.04em' }}>
        📍 GRAVITY
      </div>

      <div style={{ fontSize: '8rem', fontWeight: 900, color: '#00E676', lineHeight: 1, margin: 0 }}>
        404
      </div>

      <p style={{ fontSize: '1.4rem', fontWeight: 600, color: '#fff', margin: '1.25rem 0 0.75rem' }}>
        Oops! Page not found
      </p>

      <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.6)', marginBottom: '2.5rem', maxWidth: 400 }}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          to="/"
          style={{
            background: '#00E676',
            color: '#071a0f',
            padding: '12px 28px',
            borderRadius: 10,
            fontWeight: 700,
            textDecoration: 'none',
            marginRight: 12,
          }}
        >
          ← Go Home
        </Link>
        <Link
          to="/login"
          style={{
            border: '2px solid rgba(0,230,118,0.4)',
            color: '#00E676',
            padding: '12px 28px',
            borderRadius: 10,
            fontWeight: 600,
            textDecoration: 'none',
            background: 'transparent',
          }}
        >
          Sign In
        </Link>
      </div>
    </div>
  )
}
