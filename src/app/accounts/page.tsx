import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listAccounts } from "@/modules/finances/accounts";
import { AppShell } from "@/components/layout/AppShell";
import { AccountsClient } from "@/components/finances/AccountsClient";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const { user } = await requirePageSession();
  const [accounts, shell] = await Promise.all([
    listAccounts(user.id, { includeArchived: false }),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Cuentas"
      subtitle="Bancos, efectivo y tarjetas de crédito con precisión Decimal(19,4)"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <AccountsClient
        initialAccounts={accounts}
        defaultCurrency={shell.defaultCurrency}
      />
    </AppShell>
  );
}
