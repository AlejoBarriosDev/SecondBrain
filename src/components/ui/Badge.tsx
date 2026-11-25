import type { HTMLAttributes } from "react";

export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  default:
    "bg-zinc-500/15 text-[var(--text-secondary)] border-zinc-500/25",
  success:
    "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30",
  warning:
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  danger:
    "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  accent:
    "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  variant = "default",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
