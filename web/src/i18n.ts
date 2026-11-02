/** Minimal BG/EN string helpers shared across pages (not a full i18n framework). */

export type AppLocale = "bg" | "en";

/** Pick EN copy only when locale is explicitly `"en"`; otherwise Bulgarian. */
export function t(locale: AppLocale, bg: string, en: string): string {
  return locale === "en" ? en : bg;
}

/** Curried label helper for panels that take `(bg, en) => string`. */
export type LabelFn = (bg: string, en: string) => string;

export function labelFor(locale: AppLocale): LabelFn {
  return (bg, en) => t(locale, bg, en);
}

/** Localize an ISO timestamp for list UIs. */
export function formatWhen(iso: string, locale: AppLocale): string {
  return new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "bg-BG");
}
