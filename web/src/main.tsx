/**
 * App bootstrap: theme, React mount, and PWA service-worker policy.
 *
 * Production registers the SW (and drains the offline outbox when ready).
 * Development unregisters leftover SWs/caches that would NetworkFirst-cache
 * `/api` and leave live/SSE fetches pending forever.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { applyTheme, getStoredTheme } from "./theme";
import { drainQueue } from "./offline/drainBoot";
import "./index.css";

applyTheme(getStoredTheme());

/** Strip Workbox registrations and API GET caches left over from prod builds. */
async function unregisterDevServiceWorkers() {
  // Older browsers / non-secure contexts may lack the SW API.
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));
  // Drop Workbox runtime caches that would NetworkFirst-cache `/api`.
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      // JSX boolean prop or identifier.
      keys
        .filter((k) => k.startsWith("workbox-") || k === "api-get")
        .map((k) => caches.delete(k)),
    );
  }
}

/** Mount the React tree once the SW policy for this env is settled. */
function mount() {
  createRoot(document.getElementById("root")!).render(
    // Render JSX element.
    <StrictMode>
            <App />
        </StrictMode>,
  );
}

// Production: register PWA SW. Dev: remove leftover SW that NetworkFirst-caches
// /api and leaves live/SSE fetches pending forever — then mount.
if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // Hourly update check so clients pick up new precache manifests.
      if (registration) {
        setInterval(() => {
          // Fire-and-forget async/side effect.
          void registration.update();
        }, 60 * 60 * 1000);
      }
    },
    onOfflineReady() {
      // SW is ready — drain any IndexedDB outbox left from a prior offline session.
      void drainQueue();
    },
  });
  mount();
} else {
  // Dev: clean leftover prod SW first so API/SSE are never stuck pending.
  void unregisterDevServiceWorkers().finally(mount);
}
