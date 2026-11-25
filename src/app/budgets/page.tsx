import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listBudgets } from "@/modules/finances/budgets";
import { listCategories } from "@/modules/finances/categories";
import { AppShell } from "@/components/layout/AppShell";
import { BudgetsClient } from "@/components/finances/BudgetsClient";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const { user } = await requirePageSession();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const [budgets, categories, shell] = await Promise.all([
    listBudgets(user.id, { year, month }),
    listCategories(user.id),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Presupuestos"
      subtitle="Límites mensuales por categoría con alertas automáticas"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <BudgetsClient
        initialBudgets={budgets}
        categories={categories}
        initialYear={year}
        initialMonth={month}
        defaultCurrency={shell.defaultCurrency}
      />
    </AppShell>
  );
}
