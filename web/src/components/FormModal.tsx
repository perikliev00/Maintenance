/**
 * Centered modal dialog for create/edit forms.
 * Escape closes (unless blocked), focus returns after unmount, body scroll locked.
 */
import {
  // List item in import/export/params.
  useEffect,
  // List item in import/export/params.
  useId,
  // List item in import/export/params.
  useRef,
  // Local type alias shaping data.
  type FormEvent,
  // Local type alias shaping data.
  type ReactNode,
// Close multi-line construct with trailing syntax.
} from "react";
// Import dependency used by this module.
import { createPortal } from "react-dom";
// Import dependency used by this module.
import { useModalLifecycle } from "../hooks/useModalLifecycle";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  title: string;
  // Field/property in this shape.
  busy?: boolean;
  // Field/property in this shape.
  dirty?: boolean;
  // Field/property in this shape.
  error?: string | null;
  // Field/property in this shape.
  submitLabel: string;
  // Field/property in this shape.
  cancelLabel: string;
  // Arrow function / callback body.
  onSubmit: (e: FormEvent) => void;
  // Arrow function / callback body.
  onClose: () => void;
  // Field/property in this shape.
  children: ReactNode;
  /** Wider layout for membership pickers. */
  wide?: boolean;
};

// Exported function entry point.
export function FormModal({
  // List item in import/export/params.
  title,
  // Assign value for subsequent use.
  busy = false,
  // Assign value for subsequent use.
  dirty = false,
  // List item in import/export/params.
  error,
  // List item in import/export/params.
  submitLabel,
  // List item in import/export/params.
  cancelLabel,
  // List item in import/export/params.
  onSubmit,
  // List item in import/export/params.
  onClose,
  // List item in import/export/params.
  children,
  // Assign value for subsequent use.
  wide = false,
// Open multi-line construct.
}: Props) {
  // Local constant binding.
  const titleId = useId();
  // Local constant binding.
  const panelRef = useRef<HTMLDivElement>(null);
  // Local constant binding.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Arrow function / callback body.
  useEffect(() => {
    // Assign value for subsequent use.
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Continue module logic.
    panelRef.current
      // Invoke helper or pass arguments.
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      // Invoke helper or pass arguments.
      ?.focus();
  // Close multi-line construct with trailing syntax.
  }, []);

  // Open multi-line construct.
  useModalLifecycle(onClose, {
    // List item in import/export/params.
    busy,
    // List item in import/export/params.
    dirty,
    // Arrow function / callback body.
    onCleanup: () => {
      // Invoke helper or pass arguments.
      previouslyFocused.current?.focus?.();
    },
  });

  // Function definition.
  function requestClose() {
    // Conditional branch for this case.
    if (busy) return;
    // Conditional branch for this case.
    if (dirty) {
      // Local constant binding.
      const ok = window.confirm(
        // Continue multi-line list/arguments.
        "Има незаписани промени. Да се отхвърлят ли?",
      );
      // Conditional branch for this case.
      if (!ok) return;
    }
    // Invoke helper or pass arguments.
    onClose();
  }

  // Return computed result to caller.
  return createPortal(
    // Render JSX element.
    <div
      // Assign value for subsequent use.
      className="modal-backdrop"
      // Assign value for subsequent use.
      role="presentation"
      // Assign value for subsequent use.
      onClick={requestClose}
    >
      // Render JSX element.
      <div
        // Assign value for subsequent use.
        ref={panelRef}
        // Assign value for subsequent use.
        className={`panel modal${wide ? " housekeeping-modal" : ""}`}
        // Assign value for subsequent use.
        role="dialog"
        // Assign value for subsequent use.
        aria-modal="true"
        // Assign value for subsequent use.
        aria-labelledby={titleId}
        // Arrow function / callback body.
        onClick={(e) => e.stopPropagation()}
      >
        // Render JSX element.
        <div className="panel-header">
          // Render JSX element.
          <h2 id={titleId}>{title}</h2>
          // Render JSX element.
          <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            className="ghost"
            // Assign value for subsequent use.
            aria-label="Close"
            // Assign value for subsequent use.
            onClick={requestClose}
            // Assign value for subsequent use.
            disabled={busy}
          >
            // Continue module logic.
            ×
          // JSX element boundary.
          </button>
        // JSX element boundary.
        </div>
        // JSX expression container.
        {error && <p className="error-banner">{error}</p>}
        // Render JSX element.
        <form className="report-form modal-form-scroll" onSubmit={onSubmit}>
          // JSX expression container.
          {children}
          // Render JSX element.
          <div className="modal-actions">
            // Render JSX element.
            <button type="button" className="ghost" onClick={requestClose} disabled={busy}>
              // JSX expression container.
              {cancelLabel}
            // JSX element boundary.
            </button>
            // Render JSX element.
            <button type="submit" disabled={busy}>
              // JSX expression container.
              {busy ? "…" : submitLabel}
            // JSX element boundary.
            </button>
          // JSX element boundary.
          </div>
        // JSX element boundary.
        </form>
      // JSX element boundary.
      </div>
    // JSX element boundary.
    </div>,
    // Continue multi-line list/arguments.
    document.body,
  );
}
