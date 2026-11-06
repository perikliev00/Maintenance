/**
 * Universal loading chrome: delayed spinner + label.
 * Pages keep their own loading flags; this only renders presentation.
 */
import { useEffect, useState } from "react";
import { createDelayedVisible } from "../lib/delayedVisible";

export const LOADING_INDICATOR_DEFAULT_DELAY_MS = 150;

type Variant = "block" | "inline";

type Props = {
  /** When true, schedule show after delay; false hides immediately. */
  active?: boolean;
  /** Accessible / visible label (keep existing i18n strings for e2e). */
  label: string;
  variant?: Variant;
  /** Anti-flicker delay; 0 = show immediately. */
  delayMs?: number;
  className?: string;
};

export function LoadingIndicator({
  active = true,
  label,
  variant = "block",
  delayMs = LOADING_INDICATOR_DEFAULT_DELAY_MS,
  className,
}: Props) {
  const [visible, setVisible] = useState(
    () => active && delayMs <= 0,
  );

  useEffect(() => {
    const ctrl = createDelayedVisible(setVisible, delayMs);
    ctrl.setActive(active);
    return () => ctrl.dispose();
  }, [active, delayMs]);

  if (!visible) return null;

  const rootClass = [
    "loading-indicator",
    `loading-indicator--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const Tag = variant === "inline" ? "span" : "p";

  return (
    <Tag
      className={rootClass}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="loading-indicator__spinner" aria-hidden="true" />
      <span className="loading-indicator__label">{label}</span>
    </Tag>
  );
}
