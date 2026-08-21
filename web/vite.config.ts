import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/*
  What the About block and the sidebar show.

  BUILD_VERSION comes from `git describe --tags` (or the tag itself on a
  release build), so it is derived rather than remembered: on a tag it
  reads 1.1.0, and twelve commits later 1.1.0-12-gabc1234, which is the
  literal truth about a continuously deployed hub. The manifest version
  is only the fallback for a build with no git and no argument — a
  tarball, or a plain `npm run build` — and it will drift, which is
  exactly why nothing important depends on it.

  BUILD_SHA is separate because .git never enters the image and the
  commit is worth having even when the version already implies it.
*/
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const BUILD_SHA = (process.env.BUILD_SHA ?? '').slice(0, 7);
const BUILD_VERSION = (process.env.BUILD_VERSION ?? '').replace(/^v/, '') || pkg.version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_VERSION),
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  plugins: [
    react(),
    tailwindcss(),
    /*
      PWA (#9): installable app + offline reading + update detection.
      Everything stays self-hosted at runtime (the strict CSP allows no
      external scripts); the plugin is build-time only. Registration is
      manual (web/src/lib/pwa.ts) — the app skips it in demo mode, and
      the "prompt" mode drives the "hub was updated" toast instead of
      silently activating a new worker under a running session.
    */
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Family Hub',
        short_name: 'Family Hub',
        description: 'Tasks, notes, calendar and money for a household',
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f7f4',
        theme_color: '#f6f7f4',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The SPA shell answers offline navigations; the API never does
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Attachments are immutable by id — cache-first, capped
            urlPattern: /\/api\/attachments\/[0-9a-f-]+/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'attachments',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The one auth read that must survive offline: without a
            // cached session answer an offline reload lands on the
            // sign-in screen and the cached data below is unreachable.
            // NetworkFirst keeps it honest online; logout clears the
            // cache (see logout() in lib/auth.tsx).
            urlPattern: /\/api\/auth\/me$/,
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'session',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Offline READ of hub data: fresh when online, the last
            // snapshot when not. The rest of auth stays uncached.
            urlPattern: /\/api\/(?!auth\/)/,
            method: 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-reads',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true, // доступ с планшета и телефона по локальной сети
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
