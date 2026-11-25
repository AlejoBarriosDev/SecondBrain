import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listAccounts } from "@/modules/finances/accounts";
import { listTransfers } from "@/modules/finances/transfers";
import { AppShell } from "@/components/layout/AppShell";
import { TransfersClient } from "@/components/finances/TransfersClient";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const { user } = await requirePageSession();
  const [transferResult, accounts, shell] = await Promise.all([
    listTransfers(user.id, { page: 1, pageSize: 50 }),
    listAccounts(user.id, { includeArchived: false }),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Transferencias"
      subtitle="Movimientos pareados entre cuentas con bloqueo concurrente FOR UPDATE"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <TransfersClient
        initialTransfers={transferResult.items}
        accounts={accounts}
      />
    </AppShell>
  );
}
