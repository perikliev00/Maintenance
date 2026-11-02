/**
 * Centered modal dialog for create/edit forms.
 * Escape closes (unless blocked), focus returns after unmount, body scroll locked.
 */
import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModalLifecycle } from "../hooks/useModalLifecycle";

type Props = {
  title: string;
  busy?: boolean;
  dirty?: boolean;
  error?: string | null;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  children: ReactNode;
  /** Wider layout for membership pickers. */
  wide?: boolean;
};

export function FormModal({
  title,
  busy = false,
  dirty = false,
  error,
  submitLabel,
  cancelLabel,
  onSubmit,
  onClose,
  children,
  wide = false,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      ?.focus();
  }, []);

  useModalLifecycle(onClose, {
    busy,
    dirty,
    onCleanup: () => {
      previouslyFocused.current?.focus?.();
    },
  });

  function requestClose() {
    if (busy) return;
    if (dirty) {
      const ok = window.confirm(
        "Има незаписани промени. Да се отхвърлят ли?",
      );
      if (!ok) return;
    }
    onClose();
  }

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        className={`panel modal${wide ? " housekeeping-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="ghost"
            aria-label="Close"
            onClick={requestClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        {error && <p className="error-banner">{error}</p>}
        <form className="report-form modal-form-scroll" onSubmit={onSubmit}>
          {children}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={requestClose} disabled={busy}>
              {cancelLabel}
            </button>
            <button type="submit" disabled={busy}>
              {busy ? "…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
