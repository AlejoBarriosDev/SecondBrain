export type ThemeValue = "DARK" | "LIGHT";

export const THEME_STORAGE_KEY = "secondbrain-theme";

/**
 * Normalizes any persisted or external theme string into strict "DARK" | "LIGHT".
 * Defaults to "DARK" (dark-first Life OS).
 */
export function normalizeTheme(value: unknown): ThemeValue {
  if (typeof value === "string" && value.trim().toUpperCase() === "LIGHT") {
    return "LIGHT";
  }
  return "DARK";
}

/**
 * Pre-paint inline script injected into <head> to prevent FOUC.
 * Reads localStorage("secondbrain-theme") and synchronizes <html> class + data-theme
 * before first paint. Falls back safely to dark mode if storage is unavailable.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var v=window.localStorage.getItem(k);var isLight=typeof v==="string"&&v.trim().toUpperCase()==="LIGHT";var el=document.documentElement;if(isLight){el.classList.remove("dark");el.classList.add("light");el.setAttribute("data-theme","light");}else{el.classList.remove("light");el.classList.add("dark");el.setAttribute("data-theme","dark");}}catch(_){var el=document.documentElement;el.classList.remove("light");el.classList.add("dark");el.setAttribute("data-theme","dark");}})();`;

/**
 * Applies the selected theme to document.documentElement and persists it to localStorage.
 */
export function applyThemeToDom(theme: ThemeValue): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (theme === "LIGHT") {
    el.classList.remove("dark");
    el.classList.add("light");
    el.setAttribute("data-theme", "light");
  } else {
    el.classList.remove("light");
    el.classList.add("dark");
    el.setAttribute("data-theme", "dark");
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage quota/privacy errors
  }
}
