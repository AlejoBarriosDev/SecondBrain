import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { getFinanceDashboard } from "@/modules/finances/dashboard";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user } = await requirePageSession();
  const [dashboard, shell] = await Promise.all([
    getFinanceDashboard(user.id),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Command Center"
      subtitle="Vista ejecutiva de patrimonio, flujo mensual y bandeja financiera"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={dashboard.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <DashboardClient
        initialData={dashboard}
        defaultCurrency={shell.defaultCurrency}
      />
    </AppShell>
  );
}
