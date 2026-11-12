/** Minimal BG/EN string helpers shared across pages (not a full i18n framework). */

// Supported UI locales for the lightweight helper API.
export type AppLocale = "bg" | "en";

/** Pick EN copy only when locale is explicitly `"en"`; otherwise Bulgarian. */
export function t(locale: AppLocale, bg: string, en: string): string {
  // Default to Bulgarian for any non-English locale value.
  return locale === "en" ? en : bg;
}

/** Curried label helper for panels that take `(bg, en) => string`. */
export type LabelFn = (bg: string, en: string) => string;

// Bind a locale into a reusable (bg, en) => string label function.
export function labelFor(locale: AppLocale): LabelFn {
  // Close over locale so callers only pass the two language strings.
  return (bg, en) => t(locale, bg, en);
}

/** Localize an ISO timestamp for list UIs. */
export function formatWhen(iso: string, locale: AppLocale): string {
  // Format with en-GB or bg-BG locale conventions based on AppLocale.
  return new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "bg-BG");
}
