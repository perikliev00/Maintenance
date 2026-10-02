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
        runtimeCaching: [
          {
            // Cache short JSON GETs only — never SSE/streams (hangs SW + saturates connections).
            urlPattern: ({ url, request }) => {
              if (request.headers.get("accept")?.includes("text/event-stream")) {
                return false;
              }
              const path = url.pathname;
              if (
                path.includes("/events/") ||
                path.includes("/operations/live") ||
                path.includes("/sync")
              ) {
                return false;
              }
              return (
                path.startsWith("/api/") || url.origin.includes("localhost:4000")
              );
            },
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "api-get",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 30 },
            },
          },
        ],
      },
      // SW in Vite middleware hangs API/SSE in local dev (NetworkFirst on /api/*).
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
