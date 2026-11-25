import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listAccounts } from "@/modules/finances/accounts";
import { listCategories } from "@/modules/finances/categories";
import { listRecurringRules } from "@/modules/finances/recurring";
import { AppShell } from "@/components/layout/AppShell";
import { RecurringClient } from "@/components/finances/RecurringClient";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const { user } = await requirePageSession();
  const [rules, accounts, categories, shell] = await Promise.all([
    listRecurringRules(user.id),
    listAccounts(user.id, { includeArchived: false }),
    listCategories(user.id),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Recurrentes"
      subtitle="Suscripciones, pagos programados y ejecutor idempotente"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <RecurringClient
        initialRules={rules}
        accounts={accounts}
        categories={categories}
      />
    </AppShell>
  );
}
