import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a worker that takes over on the next
      // navigation can swap the app out from under a half-typed report.
      // ConnectionBar asks first.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Alken Decor Limited',
        short_name: 'Alken Decor',
        description: 'Construction finishes management',
        theme_color: '#14284a',
        background_color: '#f8fafc',
        display: 'standalone',
        // iOS will not take an SVG for a home-screen icon — it screenshots the
        // page instead — and Android letterboxes a non-maskable one inside a
        // white circle. For a product installed from the home screen, the icon
        // is the first impression, so it ships as real raster art at both
        // purposes. Generated from favicon.svg; see scripts/gen-icons.cjs.
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
        runtimeCaching: [
          // Field connectivity is poor: last-known API data beats a spinner.
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/v1') &&
              !url.pathname.startsWith('/api/v1/auth') &&
              request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 3600 },
            },
          },
          // Filing the diary is the supervisor's actual job, done on a phone,
          // on a site, at six in the evening — the exact moment there is no
          // signal. A failed POST used to lose the typing. Now it queues and
          // replays when the connection returns.
          //
          // Deliberately limited to the two report endpoints: both are upserts
          // keyed on (project, date) and (project, week), so a replay that
          // lands twice writes the same row twice and changes nothing. A queue
          // in front of a non-idempotent write (attendance punches, payments)
          // would post duplicates, so those are left online-only on purpose.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'POST' &&
              /\/api\/v1\/projects\/[^/]+\/(daily|weekly)-reports$/.test(url.pathname),
            handler: 'NetworkOnly',
            options: {
              backgroundSync: {
                name: 'report-queue',
                options: { maxRetentionTime: 24 * 60 }, // minutes
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
});
