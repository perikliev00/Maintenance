/**
 * Delayed visibility for loading chrome: skip ultra-short flashes.
 * Framework-free so node:test can drive timers without React.
 */

export type DelayedVisibleClock = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const defaultClock: DelayedVisibleClock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Controller: `active=true` shows only after `delayMs`; `active=false` hides immediately.
 * `delayMs <= 0` shows immediately when activated.
 */
export function createDelayedVisible(
  onChange: (visible: boolean) => void,
  delayMs: number,
  clock: DelayedVisibleClock = defaultClock,
): {
  setActive: (active: boolean) => void;
  dispose: () => void;
  isVisible: () => boolean;
} {
  let timer: unknown = null;
  let visible = false;

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    onChange(visible);
  };

  const clearTimer = () => {
    if (timer == null) return;
    clock.clearTimeout(timer);
    timer = null;
  };

  return {
    isVisible: () => visible,
    setActive(active: boolean) {
      clearTimer();
      if (!active) {
        setVisible(false);
        return;
      }
      if (delayMs <= 0) {
        setVisible(true);
        return;
      }
      timer = clock.setTimeout(() => {
        timer = null;
        setVisible(true);
      }, delayMs);
    },
    dispose() {
      clearTimer();
    },
  };
}
