import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Without this, a render-time crash on any route (e.g. Timeline/SmartPlaces)
// leaves the whole SPA on a permanent blank white screen with no way to
// recover short of a manual reload, and no visible clue what broke — this
// shows the actual error instead so it can be diagnosed without DevTools.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          background: '#020C05',
          color: '#E8F5E9',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: '#5E8B6E', marginBottom: 20, maxWidth: 320, wordBreak: 'break-word' }}>
            {this.state.error.message || String(this.state.error)}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.href = '/parent/panel' }}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: '#00E676',
              color: '#071a0f',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Go back to Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
