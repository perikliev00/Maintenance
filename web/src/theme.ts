export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "theme";

export function getStoredTheme(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "light" ? "light" : "dark";
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
