"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({
  showLabel = false,
  className = "",
}: {
  showLabel?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "DARK";
  const label = isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={`sb-elevated sb-text-primary inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-2.5 text-xs font-medium transition-colors hover:border-indigo-500/60 cursor-pointer ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 text-indigo-500" aria-hidden="true" />
      )}
      {showLabel ? <span>{isDark ? "Tema oscuro" : "Tema claro"}</span> : null}
    </button>
  );
}
