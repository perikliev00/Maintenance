import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "..");

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "pwa-192.png", "pwa-512.png"],
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
  // Allow importing the shared permissions catalog from ../api/src/contracts.
  resolve: {
    alias: {
      "@maintenance/contracts": path.resolve(
        repoRoot,
        "api/src/contracts/permissionsCatalog.ts",
      ),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
