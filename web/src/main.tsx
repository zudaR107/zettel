import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Placeholder root - replaced by the real router/auth-provider wiring
// once the base web shell lands (see issue #4).
function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      Zettel
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
