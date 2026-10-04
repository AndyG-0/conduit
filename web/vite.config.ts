import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // In dev, the backend runs separately (see server/README or
      // DEPLOYMENT.md); in production Caddy/Express serve both from one
      // origin, so this proxy only matters for `pnpm --filter @conduit/web dev`.
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      // The plugin's own manifest generation (`generateBundle`-based) is
      // incompatible with Vite 8's Rolldown bundler as of vite-plugin-pwa
      // 0.21.2 (silently drops the file — see the rollup "assigns to bundle
      // variable" warning at build time). Hand-written as
      // `public/manifest.webmanifest` instead, copied verbatim by Vite's
      // static public-dir handling; `index.html` already links to it.
      manifest: false,
      workbox: {
        runtimeCaching: [
          {
            // A cold reload after a bfcache miss should still paint fast,
            // but must never show stale tiles for long — falls back to
            // cache only when the network is actually unreachable.
            urlPattern: /\/api\/(tiles|preferences)(\/|$)/,
            handler: "NetworkFirst",
            options: { cacheName: "conduit-api", networkTimeoutSeconds: 3 },
          },
          {
            urlPattern: /\/api\/proxy\/favicon/,
            handler: "CacheFirst",
            options: {
              cacheName: "conduit-favicons",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
});
