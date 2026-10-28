/** Locale helpers for the Team (people / onboarding) UI. */
export function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}
