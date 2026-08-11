import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered explicitly via virtual:pwa-register in main.tsx instead —
      // the auto-injected bare script only calls .register() with no
      // controllerchange handling, so `registerType: 'autoUpdate'` above had
      // no actual effect: a client could keep running an old cached bundle
      // indefinitely (a real booking's confirmation email came out missing
      // the calendar attachment/link entirely because of this — the deployed
      // server code was correct, but the phone was still executing a
      // pre-calendar-feature build).
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'robots.txt'],
      // Explicit rather than relying on plugin defaults: a new deploy must
      // replace the old service worker and its caches immediately, so a
      // home-screen shortcut always reloads to the latest build instead of
      // getting stuck serving a stale cached version.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true
      },
      manifest: {
        // Stable id/scope so browsers/OSes keep treating every future
        // deploy as updates to the SAME installed app, not a new one.
        id: '/',
        scope: '/',
        name: 'Ice Rink Booking',
        short_name: 'IceRink',
        description: 'Book the rink or a zone for a time slot — no login required',
        theme_color: '#1a1a1a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
