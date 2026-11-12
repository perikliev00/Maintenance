/**
 * Browser-only outbox drain wiring. Import from main / SW ready only —
 * not from page mutation paths — so Vite can code-split queueDrain.
 */
import { markReachable } from "./connState";
// Import dependency used by this module.
import { drainQueue } from "./queueDrain";

// Re-export selected public symbols.
export { drainQueue };

// Conditional branch for this case.
if (typeof window !== "undefined") {
  // Arrow function / callback body.
  window.addEventListener("online", () => {
    // Invoke helper or pass arguments.
    markReachable();
    // Fire-and-forget async/side effect.
    void drainQueue();
  });
  // Conditional branch for this case.
  if (navigator.onLine) {
    // Fire-and-forget async/side effect.
    void drainQueue();
  }
}
