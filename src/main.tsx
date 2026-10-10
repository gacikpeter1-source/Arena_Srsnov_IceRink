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
//
// That polling alone was never enough, though — `registration.update()`
// only checks for and installs a new worker; skipWaiting/clientsClaim then
// let it take over as *controller* for future requests, but the page's own
// already-executing JS (React state, closures, the running bundle) keeps
// running regardless until something actually reloads it. An always-on
// kiosk tab (the rink-schedule TV board, left open for days) could sit on
// a stale build indefinitely even though a newer one had long since
// deployed and "taken over" in the background. `controllerchange` fires
// exactly once, right when that handoff happens, so reloading there is the
// one reliable point to pick up the new code — guarded by `refreshed` since
// the event can in principle fire more than once per page life.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    // Check for an update right away, not just on the first 60s tick —
    // `setInterval` alone leaves a device that already had an old service
    // worker installed (e.g. a browser that visited this site before a
    // deploy) serving stale precached content for up to a full minute on a
    // fresh visit/QR scan before the first check even runs. An immediate
    // check shrinks that window to roughly however long install+activate
    // actually takes (a few seconds), while the interval keeps covering an
    // already-open, long-running tab (the kiosk TV boards) the same as before.
    registration.update()
    setInterval(() => registration.update(), 60_000)
  }
})

if ('serviceWorker' in navigator) {
  let refreshed = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshed) return
    refreshed = true
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
