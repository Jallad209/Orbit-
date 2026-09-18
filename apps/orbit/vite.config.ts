/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export const WEB_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

export default defineConfig({
  // The app's own version, for the diagnostics report.
  define: { __ORBIT_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      name: 'orbit-web-csp',
      apply: 'build',
      transformIndexHtml: process.env.TAURI_ENV_PLATFORM
        ? undefined
        : {
            order: 'pre',
            handler() {
              return [
                {
                  tag: 'meta',
                  attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP },
                  injectTo: 'head-prepend',
                },
              ];
            },
          },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Orbit',
        short_name: 'Orbit',
        description:
          'A personal operating system that turns goals, routines, and commitments into a daily plan. Fully offline.',
        theme_color: '#1C1B1A',
        background_color: '#F5F1EA',
        display: 'standalone',
        start_url: '/today',
        scope: '/',
        lang: 'en',
        categories: ['productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the whole bundle, fonts included, so airplane mode works.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tauri watches Rust sources itself. Letting Vite descend into the 16 GiB
      // Cargo target tree makes startup slower and can fail on locked DLLs.
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    name: 'orbit',
    environment: 'jsdom',
    globals: false,
    css: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
