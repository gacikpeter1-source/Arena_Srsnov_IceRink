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
      includeAssets: ['favicon.svg', 'robots.txt'],
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
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
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
