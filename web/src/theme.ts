/**
 * Light/dark theme persistence via `data-theme` on `<html>`.
 * Absence of a stored preference lets bootstrap apply the hotel default theme.
 */
export type ThemeMode = "dark" | "light";

// localStorage key used for the user's explicit theme preference.
const STORAGE_KEY = "theme";

/** True when the user (or a prior visit) explicitly chose a theme. */
export function hasUserThemePreference(): boolean {
  // Null means bootstrap may apply the hotel default from public settings.
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** Stored theme, or dark when unset. */
export function getStoredTheme(): ThemeMode {
  // Read the raw persisted theme string from localStorage.
  const raw = localStorage.getItem(STORAGE_KEY);
  // Only `"light"` is explicit; anything else (including missing) → dark.
  return raw === "light" ? "light" : "dark";
}

/** Apply CSS theme attribute and persist the choice. */
export function applyTheme(theme: ThemeMode) {
  // CSS variables key off `data-theme` on the root element.
  document.documentElement.setAttribute("data-theme", theme);
  // Persist the explicit choice so reloads keep the user's preference.
  localStorage.setItem(STORAGE_KEY, theme);
}

/** Flip light↔dark, persist, and return the new mode for React state. */
export function toggleTheme(current: ThemeMode): ThemeMode {
  // Compute the opposite theme of the current mode.
  const next = current === "dark" ? "light" : "dark";
  // Apply and persist the flipped theme.
  applyTheme(next);
  // Return the new mode for callers that update React state.
  return next;
}
