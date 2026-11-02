/**
 * Browser-only outbox drain wiring. Import from main / SW ready only —
 * not from page mutation paths — so Vite can code-split queueDrain.
 */
import { markReachable } from "./connState";
import { drainQueue } from "./queueDrain";

export { drainQueue };

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    markReachable();
    void drainQueue();
  });
  if (navigator.onLine) {
    void drainQueue();
  }
}
