import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import './i18n'
import './index.css'

// registerType: 'autoUpdate' (vite.config.ts) only controls the generated
// service worker's own behavior (skipWaiting/clientsClaim) — a client still
// needs to react to a new worker taking control, or it keeps running the old
// cached bundle until some unrelated full reload happens. `immediate: true`
// registers on load rather than waiting for a 'load' event that already
// fired; onRegisteredSW polls for a new worker every 60s so an already-open
// tab (or a backgrounded-then-resumed iOS PWA, which doesn't reliably do a
// true network reload) picks up a new deploy on its own.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    setInterval(() => registration.update(), 60_000)
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
