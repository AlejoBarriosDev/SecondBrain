"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import {
  isNavItemActive,
  MOBILE_MORE_HREFS,
  MOBILE_PRIMARY_HREFS,
  NAV_ITEMS,
} from "@/lib/ui/navigation";
import { NavIcon } from "./NavIcon";

export function MobileBottomNav({
  pendingInboxCount = 0,
}: {
  pendingInboxCount?: number;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const primarySlots = MOBILE_PRIMARY_HREFS.map((href) =>
    NAV_ITEMS.find((item) => item.href === href),
  ).filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));

  const moreItems = MOBILE_MORE_HREFS.map((href) =>
    NAV_ITEMS.find((item) => item.href === href),
  ).filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));

  const isMoreActive = moreItems.some((item) =>
    isNavItemActive(pathname, item.href),
  );

  return (
    <>
      {moreOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Más secciones"
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div className="sb-surface w-full rounded-t-2xl border-t p-5 pb-8 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="sb-text-primary text-sm font-semibold">
                Más secciones
              </h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Cerrar menú"
                className="sb-text-secondary rounded-lg p-1.5 hover:bg-zinc-500/15 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {moreItems.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium transition-colors ${
                      active
                        ? "border-indigo-500/40 bg-indigo-600/15 text-indigo-500 dark:text-indigo-300"
                        : "sb-elevated sb-text-primary"
                    }`}
                  >
                    <NavIcon icon={item.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Navegación móvil"
        data-testid="mobile-bottom-nav"
        className="sb-surface fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t px-1 lg:hidden"
      >
        {primarySlots.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const showBadge = item.href === "/inbox" && pendingInboxCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium transition-colors ${
                active
                  ? "text-indigo-500 dark:text-indigo-400"
                  : "sb-text-secondary"
              }`}
            >
              <span className="relative">
                <NavIcon icon={item.icon} className="h-5 w-5" />
                {showBadge ? (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white tabular-nums">
                    {pendingInboxCount > 9 ? "9+" : pendingInboxCount}
                  </span>
                ) : null}
              </span>
              <span className="truncate">{item.shortLabel}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-label="Más secciones"
          className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium transition-colors cursor-pointer ${
            isMoreActive || moreOpen
              ? "text-indigo-500 dark:text-indigo-400"
              : "sb-text-secondary"
          }`}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          <span>Más</span>
        </button>
      </nav>
    </>
  );
}
