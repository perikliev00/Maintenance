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
      includeAssets: ["studio-icon.svg", "studio-192.png", "studio-512.png"],
      manifest: {
        name: "Meridian Operations Studio",
        short_name: "Meridian",
        description: "Hotel housekeeping and maintenance operations",
        theme_color: "#234ee8",
        background_color: "#f3f5f9",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "bg",
        icons: [
          {
            src: "studio-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "studio-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "studio-icon.svg",
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
