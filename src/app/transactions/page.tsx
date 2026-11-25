import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listAccounts } from "@/modules/finances/accounts";
import { listCategories } from "@/modules/finances/categories";
import { listTransactions } from "@/modules/finances/transactions";
import { listTags } from "@/modules/core/tags";
import { AppShell } from "@/components/layout/AppShell";
import { TransactionsClient } from "@/components/finances/TransactionsClient";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const { user } = await requirePageSession();
  const [txResult, accounts, categories, rawTags, shell] = await Promise.all([
    listTransactions(user.id, { page: 1, pageSize: 25 }),
    listAccounts(user.id, { includeArchived: false }),
    listCategories(user.id),
    listTags(user.id),
    getShellServerContext(user.id),
  ]);

  const tags = rawTags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }));

  return (
    <AppShell
      title="Movimientos"
      subtitle="Libro mayor con filtros avanzados, etiquetas y exportación CSV/JSON"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <TransactionsClient
        initialItems={txResult.items}
        initialMeta={txResult.meta}
        accounts={accounts}
        categories={categories}
        initialTags={tags}
      />
    </AppShell>
  );
}
