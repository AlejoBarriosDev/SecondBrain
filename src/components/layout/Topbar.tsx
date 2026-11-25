"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, LogOut, Plus } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { getInitials } from "@/lib/ui/format";
import { ThemeToggle } from "./ThemeToggle";

export interface TopbarUser {
  name: string;
  email: string;
}

export function Topbar({
  title,
  subtitle,
  user,
}: {
  title: string;
  subtitle?: string;
  user: TopbarUser;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <header className="sb-surface sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur-md lg:px-8">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white lg:hidden"
          aria-label="SecondBrain Inicio"
        >
          <Brain className="h-4 w-4" aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <h1 className="sb-text-primary truncate text-base font-semibold tracking-tight sm:text-lg">
            {title}
          </h1>
          {subtitle ? (
            <p className="sb-text-secondary hidden truncate text-xs sm:block">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/transactions?new=1"
          className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Nuevo movimiento</span>
        </Link>

        <ThemeToggle />

        <div
          title={`${user.name} (${user.email})`}
          aria-label={user.name || user.email}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20 text-xs font-semibold text-indigo-500 dark:text-indigo-300 border border-indigo-500/30 select-none"
        >
          {getInitials(user.name, user.email)}
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="sb-elevated sb-text-secondary inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors hover:border-rose-500/50 hover:text-rose-500 cursor-pointer disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
