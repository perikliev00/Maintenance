/**
 * Delayed visibility for loading chrome: skip ultra-short flashes.
 * Framework-free so node:test can drive timers without React.
 */

export type DelayedVisibleClock = {
  // Arrow function / callback body.
  setTimeout: (callback: () => void, ms: number) => unknown;
  // Arrow function / callback body.
  clearTimeout: (id: unknown) => void;
};

// Local constant binding.
const defaultClock: DelayedVisibleClock = {
  // Arrow function / callback body.
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  // Arrow function / callback body.
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Controller: `active=true` shows only after `delayMs`; `active=false` hides immediately.
 * `delayMs <= 0` shows immediately when activated.
 */
export function createDelayedVisible(
  // Arrow function / callback body.
  onChange: (visible: boolean) => void,
  // Field/property in this shape.
  delayMs: number,
  // Field/property in this shape.
  clock: DelayedVisibleClock = defaultClock,
// Open multi-line construct.
): {
  // Arrow function / callback body.
  setActive: (active: boolean) => void;
  // Arrow function / callback body.
  dispose: () => void;
  // Arrow function / callback body.
  isVisible: () => boolean;
// Open multi-line construct.
} {
  // Mutable local binding.
  let timer: unknown = null;
  // Mutable local binding.
  let visible = false;

  // Const arrow/function binding.
  const setVisible = (next: boolean) => {
    // Conditional branch for this case.
    if (visible === next) return;
    // Assign value for subsequent use.
    visible = next;
    // Invoke helper or pass arguments.
    onChange(visible);
  };

  // Const arrow/function binding.
  const clearTimer = () => {
    // Conditional branch for this case.
    if (timer == null) return;
    // Invoke helper or pass arguments.
    clock.clearTimeout(timer);
    // Assign value for subsequent use.
    timer = null;
  };

  // Return computed result to caller.
  return {
    // Arrow function / callback body.
    isVisible: () => visible,
    // Invoke helper or pass arguments.
    setActive(active: boolean) {
      // Invoke helper or pass arguments.
      clearTimer();
      // Conditional branch for this case.
      if (!active) {
        // Invoke helper or pass arguments.
        setVisible(false);
        // Return computed result to caller.
        return;
      }
      // Conditional branch for this case.
      if (delayMs <= 0) {
        // Invoke helper or pass arguments.
        setVisible(true);
        // Return computed result to caller.
        return;
      }
      // Arrow function / callback body.
      timer = clock.setTimeout(() => {
        // Assign value for subsequent use.
        timer = null;
        // Invoke helper or pass arguments.
        setVisible(true);
      // Close multi-line construct with trailing syntax.
      }, delayMs);
    },
    // Invoke helper or pass arguments.
    dispose() {
      // Invoke helper or pass arguments.
      clearTimer();
    },
  };
}
