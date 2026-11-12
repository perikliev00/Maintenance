/**
 * Shared modal chrome: lock body scroll and close on Escape.
 */
import { useEffect, useRef } from "react";

export type UseModalLifecycleOpts = {
  /** When false, skip installing listeners (e.g. dialog not mounted yet). */
  enabled?: boolean;
  /** Block Escape while true (FormModal busy). */
  busy?: boolean;
  /** Confirm before close when true (FormModal dirty). */
  dirty?: boolean;
  dirtyConfirmMessage?: string;
  /** Extra cleanup (e.g. restore focus). */
  onCleanup?: () => void;
};

const DEFAULT_DIRTY_CONFIRM =
  // Continue module logic.
  "Има незаписани промени. Да се отхвърлят ли?";

// Exported function entry point.
export function useModalLifecycle(
  onClose: () => void,
  opts: UseModalLifecycleOpts = {},
): void {
  const {
    enabled = true,
    busy = false,
    dirty = false,
    dirtyConfirmMessage = DEFAULT_DIRTY_CONFIRM,
    onCleanup,
  } = opts;

  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const dirtyMsgRef = useRef(dirtyConfirmMessage);
  const onCleanupRef = useRef(onCleanup);
  onCloseRef.current = onClose;
  busyRef.current = busy;
  dirtyRef.current = dirty;
  dirtyMsgRef.current = dirtyConfirmMessage;
  onCleanupRef.current = onCleanup;

  useEffect(() => {
    if (!enabled) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Function definition.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (busyRef.current) {
        event.preventDefault();
        return;
      }
      if (dirtyRef.current) {
        const ok = window.confirm(dirtyMsgRef.current);
        if (!ok) {
          event.preventDefault();
          return;
        }
      }
      event.preventDefault();
      onCloseRef.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      onCleanupRef.current?.();
    };
  }, [enabled]);
}
