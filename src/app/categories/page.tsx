import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listCategories } from "@/modules/finances/categories";
import { AppShell } from "@/components/layout/AppShell";
import { CategoriesClient } from "@/components/finances/CategoriesClient";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const { user } = await requirePageSession();
  const [categories, shell] = await Promise.all([
    listCategories(user.id),
    getShellServerContext(user.id),
  ]);

  return (
    <AppShell
      title="Categorías"
      subtitle="Taxonomía jerárquica para ingresos y gastos"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <CategoriesClient initialCategories={categories} />
    </AppShell>
  );
}
