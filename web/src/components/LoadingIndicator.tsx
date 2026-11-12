/**
 * Universal loading chrome: delayed spinner + label.
 * Pages keep their own loading flags; this only renders presentation.
 */
import { useEffect, useState } from "react";
// Import dependency used by this module.
import { createDelayedVisible } from "../lib/delayedVisible";

// Exported constant / binding.
export const LOADING_INDICATOR_DEFAULT_DELAY_MS = 150;

// Local type alias shaping data.
type Variant = "block" | "inline";

// Local type alias shaping data.
type Props = {
  /** When true, schedule show after delay; false hides immediately. */
  active?: boolean;
  /** Accessible / visible label (keep existing i18n strings for e2e). */
  label: string;
  // Field/property in this shape.
  variant?: Variant;
  /** Anti-flicker delay; 0 = show immediately. */
  delayMs?: number;
  // Field/property in this shape.
  className?: string;
};

// Exported function entry point.
export function LoadingIndicator({
  // Assign value for subsequent use.
  active = true,
  // List item in import/export/params.
  label,
  // Assign value for subsequent use.
  variant = "block",
  // Assign value for subsequent use.
  delayMs = LOADING_INDICATOR_DEFAULT_DELAY_MS,
  // List item in import/export/params.
  className,
// Open multi-line construct.
}: Props) {
  // Assign value for subsequent use.
  const [visible, setVisible] = useState(
    // Arrow function / callback body.
    () => active && delayMs <= 0,
  );

  // Arrow function / callback body.
  useEffect(() => {
    // Local constant binding.
    const ctrl = createDelayedVisible(setVisible, delayMs);
    // Invoke helper or pass arguments.
    ctrl.setActive(active);
    // Return computed result to caller.
    return () => ctrl.dispose();
  // Close multi-line construct with trailing syntax.
  }, [active, delayMs]);

  // Conditional branch for this case.
  if (!visible) return null;

  // Local constant binding.
  const rootClass = [
    // Continue multi-line list/arguments.
    "loading-indicator",
    // Continue multi-line list/arguments.
    `loading-indicator--${variant}`,
    // List item in import/export/params.
    className,
  ]
    // Invoke helper or pass arguments.
    .filter(Boolean)
    // Invoke helper or pass arguments.
    .join(" ");

  // Local constant binding.
  const Tag = variant === "inline" ? "span" : "p";

  // Return computed result to caller.
  return (
    // Render JSX element.
    <Tag
      // Assign value for subsequent use.
      className={rootClass}
      // Assign value for subsequent use.
      role="status"
      // Assign value for subsequent use.
      aria-live="polite"
      // Assign value for subsequent use.
      aria-busy="true"
    >
            <span className="loading-indicator__spinner" aria-hidden="true" />
            <span className="loading-indicator__label">{label}</span>
        </Tag>
  );
}
