"use client";

import Link from "next/link";
import { Home, RefreshCw } from "lucide-react";

export function OfflineActions() {
  const handleRetry = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <button
        type="button"
        onClick={handleRetry}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Reintentar
      </button>
      <Link
        href="/"
        className="sb-elevated sb-text-primary inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition-colors hover:border-indigo-500/50"
      >
        <Home className="h-4 w-4" aria-hidden="true" />
        Volver al inicio
      </Link>
    </div>
  );
}
