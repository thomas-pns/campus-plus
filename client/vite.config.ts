import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import paquet from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __VERSION__: JSON.stringify(paquet.version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      // Enregistrement fait dans src/main.tsx : aucun script en ligne dans la page (politique de sécurité stricte).
      injectRegister: null,
      includeAssets: ['icone.svg', 'icone-180.png'],
      manifest: {
        name: 'Campus+',
        short_name: 'Campus+',
        description: 'Planning, notes et alertes pour les élèves de CPE Lyon (non officiel).',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#F2F4F8',
        theme_color: '#F2F4F8',
        icons: [
          { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // L'API n'est jamais mise en cache par le service worker : les données sont gardées par l'appli elle-même.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
