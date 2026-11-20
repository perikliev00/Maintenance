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
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    function activeDialog() {
      return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
        .filter(dialog => dialog.getClientRects().length > 0).at(-1);
    }
    function focusableIn(dialog: HTMLElement) {
      return Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
    }
    const ownedDialog = activeDialog();
    const initialFocus = requestAnimationFrame(() => {
      const dialog = ownedDialog;
      if (!dialog || activeDialog() !== dialog || dialog.contains(document.activeElement)) return;
      const first = focusableIn(dialog)[0];
      if (first) first.focus();
      else { dialog.tabIndex = -1; dialog.focus(); }
    });

    // Function definition.
    function onKeyDown(event: KeyboardEvent) {
      if (!ownedDialog || activeDialog() !== ownedDialog) return;
      if (event.key === "Tab") {
        const dialog = activeDialog();
        if (!dialog) return;
        const controls = focusableIn(dialog);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.tabIndex = -1; dialog.focus(); return; }
        if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
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
      cancelAnimationFrame(initialFocus);
      window.removeEventListener("keydown", onKeyDown);
      if (onCleanupRef.current) onCleanupRef.current();
      else if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [enabled]);
}
