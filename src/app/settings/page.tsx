import { requirePageSession } from "@/lib/auth/session";
import { getShellServerContext } from "@/lib/ui/shell-data";
import { listAuditLogs } from "@/modules/core/audit-logs";
import { listModuleConfigs } from "@/modules/core/modules";
import { getUserSettings } from "@/modules/core/settings";
import { AppShell } from "@/components/layout/AppShell";
import {
  SettingsClient,
  type SerializedAuditLog,
  type SerializedModuleConfig,
  type SerializedUserSettings,
} from "@/components/settings/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user } = await requirePageSession();
  const [settings, modules, auditResult, shell] = await Promise.all([
    getUserSettings(user.id),
    listModuleConfigs(user.id),
    listAuditLogs(user.id, { page: 1, pageSize: 20 }),
    getShellServerContext(user.id),
  ]);

  const serializedSettings: SerializedUserSettings = {
    id: settings.id,
    defaultCurrency: settings.defaultCurrency,
    locale: settings.locale,
    timezone: settings.timezone,
    theme: settings.theme === "LIGHT" ? "LIGHT" : "DARK",
    fiscalMonthStartDay: settings.fiscalMonthStartDay,
    aiParserEnabled: settings.aiParserEnabled,
  };

  const serializedModules: SerializedModuleConfig[] = modules.map((m) => ({
    id: m.id,
    moduleKey: m.moduleKey,
    enabled: m.enabled,
    sortOrder: m.sortOrder,
  }));

  const serializedLogs: SerializedAuditLog[] = auditResult.items.map((l) => ({
    id: l.id,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    createdAt: l.createdAt.toISOString(),
  }));

  return (
    <AppShell
      title="Ajustes"
      subtitle="Perfil, Passkeys/Biometría, tema, Gmail, módulos y auditoría"
      user={{ name: user.name, email: user.email }}
      pendingInboxCount={shell.pendingInboxCount}
      initialTheme={shell.theme}
    >
      <SettingsClient
        user={{ name: user.name, email: user.email }}
        initialSettings={serializedSettings}
        initialModules={serializedModules}
        initialAuditLogs={serializedLogs}
      />
    </AppShell>
  );
}
