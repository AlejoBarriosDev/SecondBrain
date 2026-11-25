"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/ui/api-client";
import type { FinanceDashboardData } from "@/modules/finances/dashboard";
import {
  FeedbackBanner,
  type FeedbackMessage,
} from "@/components/ui/FeedbackBanner";
import { NetWorthHero } from "./NetWorthHero";
import { InboxWidget } from "./InboxWidget";
import { AccountsBento } from "./AccountsBento";
import { BudgetsBento } from "./BudgetsBento";
import { RecentTxBento } from "./RecentTxBento";
import { RecurringBento } from "./RecurringBento";

interface SyncSummary {
  synced?: number;
  skipped?: number;
  errors?: string[];
}

interface RunRecurringSummary {
  processedCount: number;
  skippedCount: number;
}

export function DashboardClient({
  initialData,
  defaultCurrency,
}: {
  initialData: FinanceDashboardData;
  defaultCurrency: string;
}) {
  const [data, setData] = useState<FinanceDashboardData>(initialData);
  const [syncing, setSyncing] = useState(false);
  const [runningRecurring, setRunningRecurring] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const refreshDashboard = async () => {
    const res = await apiFetch<FinanceDashboardData>("/api/finances/dashboard");
    setData(res.data);
  };

  const handleSyncGmail = async () => {
    setFeedback(null);
    setSyncing(true);
    try {
      const res = await apiFetch<SyncSummary>("/api/inbox/sync", {
        method: "POST",
      });
      await refreshDashboard();
      setFeedback({
        type: "success",
        text: `Sincronización completada: ${res.data.synced ?? 0} nuevos, ${res.data.skipped ?? 0} omitidos.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo sincronizar Gmail en este momento.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleRunRecurring = async () => {
    setFeedback(null);
    setRunningRecurring(true);
    try {
      const res = await apiFetch<RunRecurringSummary>(
        "/api/finances/recurring/run",
        { method: "POST" },
      );
      await refreshDashboard();
      const processed = res.data.processedCount ?? 0;
      const skipped = res.data.skippedCount ?? 0;
      setFeedback({
        type: "success",
        text:
          skipped > 0
            ? `Reglas recurrentes ejecutadas: ${processed} procesadas, ${skipped} omitidas.`
            : `Reglas recurrentes ejecutadas: ${processed} procesadas.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Error al ejecutar reglas recurrentes.",
      });
    } finally {
      setRunningRecurring(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        <NetWorthHero
          netWorthByCurrency={data.netWorthByCurrency}
          monthlyCashflow={data.monthlyCashflow}
          defaultCurrency={defaultCurrency}
        />

        <InboxWidget
          pendingCount={data.pendingInboxCount}
          syncing={syncing}
          onSync={handleSyncGmail}
        />

        <AccountsBento accounts={data.accounts} />

        <BudgetsBento budgets={data.budgetsSummary} />

        <RecentTxBento transactions={data.recentTransactions} />

        <RecurringBento
          rules={data.upcomingRecurring}
          running={runningRecurring}
          onRunDue={handleRunRecurring}
        />
      </div>
    </div>
  );
}
