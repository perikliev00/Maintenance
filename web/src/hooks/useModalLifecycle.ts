/**
 * Shared modal chrome: lock body scroll and close on Escape.
 */
import { useEffect, useRef } from "react";

// Export type alias for consumers.
export type UseModalLifecycleOpts = {
  /** When false, skip installing listeners (e.g. dialog not mounted yet). */
  enabled?: boolean;
  /** Block Escape while true (FormModal busy). */
  busy?: boolean;
  /** Confirm before close when true (FormModal dirty). */
  dirty?: boolean;
  // Field/property in this shape.
  dirtyConfirmMessage?: string;
  /** Extra cleanup (e.g. restore focus). */
  onCleanup?: () => void;
};

// Local constant binding.
const DEFAULT_DIRTY_CONFIRM =
  // Continue module logic.
  "Има незаписани промени. Да се отхвърлят ли?";

// Exported function entry point.
export function useModalLifecycle(
  // Arrow function / callback body.
  onClose: () => void,
  // Field/property in this shape.
  opts: UseModalLifecycleOpts = {},
// Open multi-line construct.
): void {
  // Open multi-line construct.
  const {
    // Assign value for subsequent use.
    enabled = true,
    // Assign value for subsequent use.
    busy = false,
    // Assign value for subsequent use.
    dirty = false,
    // Assign value for subsequent use.
    dirtyConfirmMessage = DEFAULT_DIRTY_CONFIRM,
    // List item in import/export/params.
    onCleanup,
  // Assign value for subsequent use.
  } = opts;

  // Local constant binding.
  const onCloseRef = useRef(onClose);
  // Local constant binding.
  const busyRef = useRef(busy);
  // Local constant binding.
  const dirtyRef = useRef(dirty);
  // Local constant binding.
  const dirtyMsgRef = useRef(dirtyConfirmMessage);
  // Local constant binding.
  const onCleanupRef = useRef(onCleanup);
  // Assign value for subsequent use.
  onCloseRef.current = onClose;
  // Assign value for subsequent use.
  busyRef.current = busy;
  // Assign value for subsequent use.
  dirtyRef.current = dirty;
  // Assign value for subsequent use.
  dirtyMsgRef.current = dirtyConfirmMessage;
  // Assign value for subsequent use.
  onCleanupRef.current = onCleanup;

  // Arrow function / callback body.
  useEffect(() => {
    // Conditional branch for this case.
    if (!enabled) return;

    // Local constant binding.
    const previousOverflow = document.body.style.overflow;
    // Assign value for subsequent use.
    document.body.style.overflow = "hidden";

    // Function definition.
    function onKeyDown(event: KeyboardEvent) {
      // Conditional branch for this case.
      if (event.key !== "Escape") return;
      // Conditional branch for this case.
      if (busyRef.current) {
        // Invoke helper or pass arguments.
        event.preventDefault();
        // Return computed result to caller.
        return;
      }
      // Conditional branch for this case.
      if (dirtyRef.current) {
        // Local constant binding.
        const ok = window.confirm(dirtyMsgRef.current);
        // Conditional branch for this case.
        if (!ok) {
          // Invoke helper or pass arguments.
          event.preventDefault();
          // Return computed result to caller.
          return;
        }
      }
      // Invoke helper or pass arguments.
      event.preventDefault();
      // Invoke helper or pass arguments.
      onCloseRef.current();
    }

    // Invoke helper or pass arguments.
    window.addEventListener("keydown", onKeyDown);
    // Return computed result to caller.
    return () => {
      // Assign value for subsequent use.
      document.body.style.overflow = previousOverflow;
      // Invoke helper or pass arguments.
      window.removeEventListener("keydown", onKeyDown);
      // Invoke helper or pass arguments.
      onCleanupRef.current?.();
    };
  // Close multi-line construct with trailing syntax.
  }, [enabled]);
}
