import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons.svg", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "Meridian Maintenance",
        short_name: "Meridian",
        description: "Hotel housekeeping and maintenance operations",
        theme_color: "#0f1c22",
        background_color: "#0f1c22",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "bg",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Do not runtime-cache authenticated /api GETs — Cache Storage is shared
        // across users on a device. Offline private data lives in IndexedDB
        // (partitioned + purged on account switch).
      },
      // Keep SW out of Vite middleware in local dev (avoids intercepting /api + SSE).
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
