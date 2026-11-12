/**
 * Browser-only outbox drain wiring. Import from main / SW ready only —
 * not from page mutation paths — so Vite can code-split queueDrain.
 */
import { markReachable } from "./connState";
import { drainQueue } from "./queueDrain";

// Re-export selected public symbols.
export { drainQueue };

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    markReachable();
    // Fire-and-forget async/side effect.
    void drainQueue();
  });
  if (navigator.onLine) {
    // Fire-and-forget async/side effect.
    void drainQueue();
  }
}
