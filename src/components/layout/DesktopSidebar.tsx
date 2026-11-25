"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain } from "lucide-react";
import { isNavItemActive, NAV_ITEMS } from "@/lib/ui/navigation";
import { NavIcon } from "./NavIcon";

export function DesktopSidebar({
  pendingInboxCount = 0,
}: {
  pendingInboxCount?: number;
}) {
  const pathname = usePathname();

  const primaryItems = NAV_ITEMS.filter((i) => i.section === "primary");
  const manageItems = NAV_ITEMS.filter((i) => i.section === "manage");
  const systemItems = NAV_ITEMS.filter((i) => i.section === "system");

  const renderSection = (title: string, items: typeof NAV_ITEMS) => (
    <div className="space-y-1">
      <p className="sb-text-muted px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </p>
      {items.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        const showBadge = item.href === "/inbox" && pendingInboxCount > 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-indigo-600/15 text-indigo-500 dark:text-indigo-300"
                : "sb-text-secondary hover:bg-zinc-500/10 hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="flex items-center gap-3 min-w-0">
              <NavIcon
                icon={item.icon}
                className={`h-4 w-4 shrink-0 ${
                  active
                    ? "text-indigo-500 dark:text-indigo-400"
                    : "sb-text-muted group-hover:text-[var(--text-primary)]"
                }`}
              />
              <span className="truncate">{item.label}</span>
            </span>
            {showBadge ? (
              <span
                aria-label={`${pendingInboxCount} pendientes`}
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums"
              >
                {pendingInboxCount > 99 ? "99+" : pendingInboxCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );

  return (
    <aside
      aria-label="Navegación principal"
      className="sb-surface hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r"
    >
      <div className="flex h-16 items-center gap-3 border-b border-[var(--border-subtle)] px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Brain className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="sb-text-primary truncate text-sm font-bold tracking-tight">
            SecondBrain
          </p>
          <p className="sb-text-muted truncate text-[11px]">
            Life OS · Finanzas
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {renderSection("Principal", primaryItems)}
        {renderSection("Gestión", manageItems)}
        {renderSection("Sistema", systemItems)}
      </nav>

      <div className="border-t border-[var(--border-subtle)] p-4">
        <div className="sb-elevated rounded-xl border px-3 py-2.5">
          <p className="sb-text-primary text-xs font-medium">Módulo 1 Activo</p>
          <p className="sb-text-muted mt-0.5 text-[11px]">
            Finanzas Personales · Decimal(19,4)
          </p>
        </div>
      </div>
    </aside>
  );
}
