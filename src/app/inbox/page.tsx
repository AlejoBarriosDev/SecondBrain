import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listAccounts } from "@/modules/finances/accounts";
import { listCategories } from "@/modules/finances/categories";
import { listInboxItems } from "@/modules/finances/inbox";
import { AppShell } from "@/components/layout/AppShell";
import { InboxClient } from "@/components/finances/InboxClient";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { user } = await requirePageSession();
  const [pendingItems, accounts, categories, shell] = await Promise.all([
    listInboxItems(user.id, { status: "PENDING", limit: 100 }),
    listAccounts(user.id, { includeArchived: false }),
    listCategories(user.id),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Bandeja de Revisión (Inbox)"
      subtitle="Correos bancarios y extractos PDF aislados hasta tu confirmación explícita"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <InboxClient
        initialItems={pendingItems}
        accounts={accounts}
        categories={categories}
        defaultCurrency={shell.defaultCurrency}
      />
    </AppShell>
  );
}
