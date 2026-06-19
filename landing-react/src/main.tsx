import { StrictMode, Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

class ErrorBoundary extends Component<{children: ReactNode}, {error: Error|null}> {
  constructor(props: {children: ReactNode}) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:'40px',fontFamily:'monospace',background:'#0a1a0f',color:'#ff5555',minHeight:'100vh'}}>
          <h2 style={{color:'#ff5555'}}>React Error</h2>
          <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all',color:'#ffaa55'}}>
            {this.state.error.message}
          </pre>
          <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all',color:'#aaa',fontSize:'12px'}}>
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

window.addEventListener('error', (e) => {
  document.getElementById('root')!.innerHTML =
    `<div style="padding:40px;font-family:monospace;background:#0a1a0f;color:#ff5555;min-height:100vh">
      <h2>JS Error</h2>
      <pre style="white-space:pre-wrap;word-break:break-all;color:#ffaa55">${e.message}</pre>
      <pre style="white-space:pre-wrap;word-break:break-all;color:#aaa;font-size:12px">${e.filename}:${e.lineno}:${e.colno}</pre>
    </div>`
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
