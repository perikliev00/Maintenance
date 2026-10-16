/**
 * components/BrandMark.tsx — UI module (densified documentation).
 */
type Props = {
  size?: number;
  className?: string;
};

/**
 * Decorative app logo mark (SVG).
 * Purely visual — `aria-hidden` so screen readers skip it.
 */
export function BrandMark({ size = 28, className }: Props) {
  // Colors come from CSS variables so the mark follows the active theme.
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="var(--accent-soft)" />
      <path
        d="M6 22.5V9.5L16 16.2L26 9.5V22.5"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16.2" r="1.8" fill="var(--accent-bright)" />
    </svg>
  );
}
