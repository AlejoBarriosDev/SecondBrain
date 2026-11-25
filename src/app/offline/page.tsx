import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { OfflineActions } from "./OfflineActions";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sin conexión — SecondBrain",
  description:
    "No hay conexión a internet disponible en este momento para sincronizar SecondBrain.",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section
        aria-labelledby="offline-title"
        className="sb-surface w-full max-w-md rounded-2xl border p-8 text-center shadow-2xl"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/30">
          <WifiOff className="h-7 w-7" aria-hidden="true" />
        </div>

        <p className="sb-text-muted text-xs font-semibold uppercase tracking-widest">
          SecondBrain — Life OS
        </p>

        <h1
          id="offline-title"
          className="sb-text-primary mt-2 text-2xl font-bold tracking-tight"
        >
          Sin conexión
        </h1>

        <p className="sb-text-secondary mt-3 text-sm leading-relaxed">
          Parece que estás desconectado de internet. Por seguridad, tus saldos,
          movimientos y datos financieros personales nunca se almacenan en caché
          sin conexión.
        </p>

        <p className="sb-text-muted mt-2 text-xs leading-relaxed">
          Verifica tu conexión a la red y vuelve a intentarlo para sincronizar
          tu Centro de Comando.
        </p>

        <OfflineActions />
      </section>
    </main>
  );
}
