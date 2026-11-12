/**
 * App bootstrap: theme, React mount, and PWA service-worker policy.
 *
 * Production registers the SW (and drains the offline outbox when ready).
 * Development unregisters leftover SWs/caches that would NetworkFirst-cache
 * `/api` and leave live/SSE fetches pending forever.
 */
import { StrictMode } from "react";
// Import dependency used by this module.
import { createRoot } from "react-dom/client";
// Import dependency used by this module.
import { registerSW } from "virtual:pwa-register";
// Import dependency used by this module.
import App from "./App";
// Import dependency used by this module.
import { applyTheme, getStoredTheme } from "./theme";
// Import dependency used by this module.
import { drainQueue } from "./offline/drainBoot";
// Import dependency used by this module.
import "./index.css";

// Invoke helper or pass arguments.
applyTheme(getStoredTheme());

/** Strip Workbox registrations and API GET caches left over from prod builds. */
async function unregisterDevServiceWorkers() {
  // Older browsers / non-secure contexts may lack the SW API.
  if (!("serviceWorker" in navigator)) return;
  // Local constant binding.
  const regs = await navigator.serviceWorker.getRegistrations();
  // Await async work before continuing.
  await Promise.all(regs.map((reg) => reg.unregister()));
  // Drop Workbox runtime caches that would NetworkFirst-cache `/api`.
  if ("caches" in window) {
    // Local constant binding.
    const keys = await caches.keys();
    // Await async work before continuing.
    await Promise.all(
      // JSX boolean prop or identifier.
      keys
        // Arrow function / callback body.
        .filter((k) => k.startsWith("workbox-") || k === "api-get")
        // Arrow function / callback body.
        .map((k) => caches.delete(k)),
    );
  }
}

/** Mount the React tree once the SW policy for this env is settled. */
function mount() {
  // Invoke helper or pass arguments.
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
  // Open multi-line construct.
  registerSW({
    // Field/property in this shape.
    immediate: true,
    // Invoke helper or pass arguments.
    onRegisteredSW(_swUrl, registration) {
      // Hourly update check so clients pick up new precache manifests.
      if (registration) {
        // Arrow function / callback body.
        setInterval(() => {
          // Fire-and-forget async/side effect.
          void registration.update();
        // Close multi-line construct with trailing syntax.
        }, 60 * 60 * 1000);
      }
    },
    // Invoke helper or pass arguments.
    onOfflineReady() {
      // SW is ready — drain any IndexedDB outbox left from a prior offline session.
      void drainQueue();
    },
  });
  // Invoke helper or pass arguments.
  mount();
// Open multi-line construct.
} else {
  // Dev: clean leftover prod SW first so API/SSE are never stuck pending.
  void unregisterDevServiceWorkers().finally(mount);
}
