/**
 * components/BrandMark.tsx — UI module (densified documentation).
 */
type Props = {
  // Field/property in this shape.
  size?: number;
  // Field/property in this shape.
  className?: string;
};

/**
 * Decorative app logo mark (SVG).
 * Purely visual — `aria-hidden` so screen readers skip it.
 */
export function BrandMark({ size = 28, className }: Props) {
  // Colors come from CSS variables so the mark follows the active theme.
  return (
    // Render JSX element.
    <svg
      // Assign value for subsequent use.
      className={className}
      // Assign value for subsequent use.
      width={size}
      // Assign value for subsequent use.
      height={size}
      // Assign value for subsequent use.
      viewBox="0 0 32 32"
      // Assign value for subsequent use.
      fill="none"
      // Assign value for subsequent use.
      aria-hidden="true"
    >
      // Render JSX element.
      <rect width="32" height="32" rx="8" fill="var(--accent-soft)" />
      // Render JSX element.
      <path
        // Assign value for subsequent use.
        d="M6 22.5V9.5L16 16.2L26 9.5V22.5"
        // Assign value for subsequent use.
        stroke="var(--accent)"
        // Assign value for subsequent use.
        strokeWidth="2.4"
        // Assign value for subsequent use.
        strokeLinecap="round"
        // Assign value for subsequent use.
        strokeLinejoin="round"
      />
      // Render JSX element.
      <circle cx="16" cy="16.2" r="1.8" fill="var(--accent-bright)" />
    // JSX element boundary.
    </svg>
  );
}
