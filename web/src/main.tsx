import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { applyTheme, getStoredTheme } from "./theme";
import { drainQueue } from "./offline";
import "./index.css";

applyTheme(getStoredTheme());

async function unregisterDevServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("workbox-") || k === "api-get")
        .map((k) => caches.delete(k)),
    );
  }
}

function mount() {
  createRoot(document.getElementById("root")!).render(
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
      if (registration) {
        setInterval(() => {
          void registration.update();
        }, 60 * 60 * 1000);
      }
    },
    onOfflineReady() {
      void drainQueue();
    },
  });
  mount();
} else {
  void unregisterDevServiceWorkers().finally(mount);
}
