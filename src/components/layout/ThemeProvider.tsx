"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeToDom,
  normalizeTheme,
  THEME_STORAGE_KEY,
  type ThemeValue,
} from "@/lib/ui/theme";

interface ThemeContextValue {
  theme: ThemeValue;
  setTheme: (next: ThemeValue, persistToServer?: boolean) => void;
  toggleTheme: () => void;
  syncServerTheme: (serverTheme: ThemeValue) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeValue>("DARK");
  const themeRef = useRef<ThemeValue>("DARK");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored) {
        const normalized = normalizeTheme(stored);
        themeRef.current = normalized;
        setThemeState(normalized);
        applyThemeToDom(normalized);
        return;
      }
    } catch {
      // ignore storage errors
    }

    const fromDom: ThemeValue = document.documentElement.classList.contains(
      "light",
    )
      ? "LIGHT"
      : "DARK";
    themeRef.current = fromDom;
    setThemeState(fromDom);
  }, []);

  const persistThemeSetting = useCallback((next: ThemeValue) => {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {
      // Silently ignore unauthenticated/network errors (e.g. on /login)
    });
  }, []);

  const setTheme = useCallback(
    (next: ThemeValue, persistToServer = true) => {
      const normalized = normalizeTheme(next);
      themeRef.current = normalized;
      setThemeState(normalized);
      applyThemeToDom(normalized);
      if (persistToServer) {
        persistThemeSetting(normalized);
      }
    },
    [persistThemeSetting],
  );

  const toggleTheme = useCallback(() => {
    const next: ThemeValue = themeRef.current === "DARK" ? "LIGHT" : "DARK";
    themeRef.current = next;
    setThemeState(next);
    applyThemeToDom(next);
    persistThemeSetting(next);
  }, [persistThemeSetting]);

  const syncServerTheme = useCallback((serverTheme: ThemeValue) => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored !== null) {
        return;
      }
    } catch {
      // If storage is unavailable, still apply server theme to DOM/state
    }
    const normalized = normalizeTheme(serverTheme);
    themeRef.current = normalized;
    setThemeState(normalized);
    applyThemeToDom(normalized);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, syncServerTheme }),
    [theme, setTheme, toggleTheme, syncServerTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function ThemeServerSync({
  initialTheme,
}: {
  initialTheme?: ThemeValue;
}) {
  const { syncServerTheme } = useTheme();

  useEffect(() => {
    if (initialTheme) {
      syncServerTheme(initialTheme);
    }
  }, [initialTheme, syncServerTheme]);

  return null;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return ctx;
}
