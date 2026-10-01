import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const DAY = 24 * 60 * 60

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Installable, offline-capable app for the field. Map tiles you've viewed are kept so a
    // site you looked at before leaving still shows with no signal.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Drone Mapping',
        short_name: 'Drone Mapping',
        description: 'Plan DJI photo missions on a live map and send them to the drone.',
        theme_color: '#13294b',
        background_color: '#13294b',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // MapLibre bundle is ~1 MB+
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(server\.arcgisonline\.com|clarity\.maptiles\.arcgis\.com)\/.*\/tile\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'imagery',
              expiration: { maxEntries: 6000, maxAgeSeconds: 30 * DAY },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * DAY } },
          },
        ],
      },
    }),
  ],
  server: {
    // Reachable from a phone on the same Wi-Fi, so QR links work during development.
    host: true,
  },
})
