"use client";

import { useEffect, useState } from "react";
import {
  Fingerprint,
  History,
  Layers,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { apiFetch } from "@/lib/ui/api-client";
import { formatDateTime } from "@/lib/ui/format";
import { useTheme } from "@/components/layout/ThemeProvider";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import {
  FeedbackBanner,
  type FeedbackMessage,
} from "@/components/ui/FeedbackBanner";
import { Input, Select } from "@/components/ui/Input";

export interface SerializedUserSettings {
  id: string;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  theme: "DARK" | "LIGHT";
  fiscalMonthStartDay: number;
  aiParserEnabled: boolean;
}

export interface SerializedModuleConfig {
  id: string;
  moduleKey: string;
  enabled: boolean;
  sortOrder: number;
}

export interface SerializedAuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface PasskeyRecord {
  id: string;
  name?: string | null;
  deviceType?: string | null;
  createdAt?: string | Date | null;
}

export function SettingsClient({
  user,
  initialSettings,
  initialModules,
  initialAuditLogs,
}: {
  user: { name: string; email: string };
  initialSettings: SerializedUserSettings;
  initialModules: SerializedModuleConfig[];
  initialAuditLogs: SerializedAuditLog[];
}) {
  const { theme, setTheme } = useTheme();
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  // Settings form
  const [defaultCurrency, setDefaultCurrency] = useState(
    initialSettings.defaultCurrency,
  );
  const [locale, setLocale] = useState(initialSettings.locale);
  const [timezone, setTimezone] = useState(initialSettings.timezone);
  const [themePref, setThemePref] = useState<"DARK" | "LIGHT">(
    initialSettings.theme,
  );

  useEffect(() => {
    setThemePref(theme);
  }, [theme]);
  const [fiscalDay, setFiscalDay] = useState(
    String(initialSettings.fiscalMonthStartDay),
  );
  const [aiParserEnabled, setAiParserEnabled] = useState(
    initialSettings.aiParserEnabled,
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Passkeys
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(
    null,
  );

  // Gmail Sync
  const [syncingGmail, setSyncingGmail] = useState(false);

  // Modules
  const [modules, setModules] =
    useState<SerializedModuleConfig[]>(initialModules);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);

  // Audit logs
  const [auditLogs, setAuditLogs] =
    useState<SerializedAuditLog[]>(initialAuditLogs);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadPasskeys = async () => {
    setLoadingPasskeys(true);
    try {
      const result = await authClient.passkey.listUserPasskeys();
      if (Array.isArray(result?.data)) {
        setPasskeys(result.data as PasskeyRecord[]);
      }
    } catch {
      // ignore initial passkey load errors in environments without WebAuthn
    } finally {
      setLoadingPasskeys(false);
    }
  };

  useEffect(() => {
    void loadPasskeys();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingSettings(true);
    try {
      const res = await apiFetch<SerializedUserSettings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          defaultCurrency: defaultCurrency.trim().toUpperCase(),
          locale: locale.trim(),
          timezone: timezone.trim(),
          theme: themePref,
          fiscalMonthStartDay: Math.min(28, Math.max(1, Number(fiscalDay) || 1)),
          aiParserEnabled,
        }),
      });
      setTheme(res.data.theme, false);
      setFeedback({
        type: "success",
        text: "Preferencias guardadas correctamente.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error guardando preferencias.",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddPasskey = async () => {
    setFeedback(null);
    setAddingPasskey(true);
    try {
      const result = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || "Mi dispositivo",
      });
      if (result?.error) {
        setFeedback({
          type: "error",
          text:
            result.error.message ||
            "No se pudo registrar la Passkey en este dispositivo.",
        });
      } else {
        setPasskeyName("");
        await loadPasskeys();
        setFeedback({
          type: "success",
          text: "Passkey / Biometría vinculada correctamente.",
        });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Registro de Passkey cancelado o no soportado por el navegador.",
      });
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setFeedback(null);
    setDeletingPasskeyId(id);
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result?.error) {
        setFeedback({
          type: "error",
          text: result.error.message || "Error eliminando Passkey.",
        });
      } else {
        await loadPasskeys();
        setFeedback({ type: "info", text: "Passkey eliminada." });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error eliminando Passkey.",
      });
    } finally {
      setDeletingPasskeyId(null);
    }
  };

  const handleSyncGmail = async () => {
    setFeedback(null);
    setSyncingGmail(true);
    try {
      const res = await apiFetch<{ synced?: number; skipped?: number }>(
        "/api/inbox/sync",
        { method: "POST" },
      );
      setFeedback({
        type: "success",
        text: `Gmail sincronizado: ${res.data.synced ?? 0} nuevos, ${res.data.skipped ?? 0} omitidos.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo sincronizar Gmail.",
      });
    } finally {
      setSyncingGmail(false);
    }
  };

  const handleToggleModule = async (mod: SerializedModuleConfig) => {
    setFeedback(null);
    setTogglingModule(mod.moduleKey);
    try {
      await apiFetch("/api/modules", {
        method: "PATCH",
        body: JSON.stringify({
          moduleKey: mod.moduleKey,
          enabled: !mod.enabled,
        }),
      });
      setModules((prev) =>
        prev.map((m) =>
          m.moduleKey === mod.moduleKey ? { ...m, enabled: !m.enabled } : m,
        ),
      );
      setFeedback({
        type: "success",
        text: `Módulo "${mod.moduleKey}" ${!mod.enabled ? "activado" : "desactivado"}.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error actualizando módulo.",
      });
    } finally {
      setTogglingModule(null);
    }
  };

  const refreshAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await apiFetch<SerializedAuditLog[]>(
        "/api/audit-logs?page=1&pageSize=20",
      );
      setAuditLogs(res.data);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error cargando auditoría.",
      });
    } finally {
      setLoadingLogs(false);
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-indigo-500" aria-hidden="true" />
              <CardTitle>Perfil Personal</CardTitle>
            </div>
            <Badge variant="success">Cuenta autorizada</Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="sb-elevated rounded-xl border p-3.5">
              <p className="sb-text-muted text-xs">Nombre</p>
              <p className="sb-text-primary mt-0.5 font-semibold">
                {user.name || "Usuario SecondBrain"}
              </p>
            </div>
            <div className="sb-elevated rounded-xl border p-3.5">
              <p className="sb-text-muted text-xs">Correo electrónico</p>
              <p className="sb-text-primary mt-0.5 font-mono text-xs">
                {user.email}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Passkeys / Biometría */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Fingerprint
                className="h-4 w-4 text-indigo-500"
                aria-hidden="true"
              />
              <div>
                <CardTitle>Passkeys / Biometría (WebAuthn)</CardTitle>
                <CardDescription>
                  Vincula Touch ID, Face ID o llaves de seguridad por dispositivo
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                aria-label="Nombre del dispositivo Passkey"
                placeholder="Ej. MacBook Pro Touch ID"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                className="sb-input h-10 flex-1 rounded-xl border px-3 text-sm"
              />
              <Button loading={addingPasskey} onClick={handleAddPasskey}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Registrar Passkey</span>
              </Button>
            </div>

            {loadingPasskeys ? (
              <p className="sb-text-muted text-xs">Cargando dispositivos...</p>
            ) : passkeys.length === 0 ? (
              <p className="sb-text-secondary rounded-xl border border-dashed border-[var(--border-strong)] p-3 text-xs">
                No hay Passkeys registradas todavía. Pulsa{" "}
                <strong>Registrar Passkey</strong> para vincular biometría en
                este dispositivo.
              </p>
            ) : (
              <ul className="space-y-2">
                {passkeys.map((pk) => (
                  <li
                    key={pk.id}
                    className="sb-elevated flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="sb-text-primary truncate text-sm font-medium">
                        {pk.name || "Passkey sin nombre"}
                      </p>
                      <p className="sb-text-muted text-xs">
                        {pk.deviceType || "WebAuthn"}
                        {pk.createdAt
                          ? ` · ${formatDateTime(pk.createdAt)}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={deletingPasskeyId === pk.id}
                      onClick={() => void handleDeletePasskey(pk.id)}
                      aria-label={`Eliminar passkey ${pk.name ?? pk.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Preferences & Appearance */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Apariencia y Preferencias</CardTitle>
              <CardDescription>
                Tema visual, moneda por defecto y motor de análisis
              </CardDescription>
            </div>
            <ThemeToggle showLabel />
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select
                  id="set-theme"
                  label="Tema guardado"
                  value={themePref}
                  onChange={(e) => {
                    const next = e.target.value as "DARK" | "LIGHT";
                    setThemePref(next);
                    setTheme(next, true);
                  }}
                >
                  <option value="DARK">Oscuro (DARK)</option>
                  <option value="LIGHT">Claro (LIGHT)</option>
                </Select>

                <Input
                  id="set-currency"
                  label="Moneda predeterminada"
                  maxLength={3}
                  required
                  value={defaultCurrency}
                  onChange={(e) =>
                    setDefaultCurrency(e.target.value.toUpperCase())
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input
                  id="set-locale"
                  label="Idioma / Locale"
                  required
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                />
                <Input
                  id="set-tz"
                  label="Zona horaria"
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                />
                <Input
                  id="set-fiscal"
                  label="Inicio mes fiscal"
                  type="number"
                  min={1}
                  max={28}
                  value={fiscalDay}
                  onChange={(e) => setFiscalDay(e.target.value)}
                />
              </div>

              <label className="sb-text-secondary inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiParserEnabled}
                  onChange={(e) => setAiParserEnabled(e.target.checked)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                <span>
                  Habilitar fallback IA/LLM en el parser híbrido de correos/PDF
                </span>
              </label>

              <div className="flex justify-end">
                <Button type="submit" loading={savingSettings}>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  <span>Guardar preferencias</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Gmail & Modules */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                <div>
                  <CardTitle>Integración Gmail (Solo lectura)</CardTitle>
                  <CardDescription>
                    Sincronización incremental con scope{" "}
                    <code>gmail.readonly</code>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="sb-text-secondary text-xs">
                Todos los movimientos detectados aterrizan en{" "}
                <strong>/inbox</strong> sin afectar saldos hasta tu revisión.
              </p>
              <Button
                variant="secondary"
                size="sm"
                loading={syncingGmail}
                onClick={handleSyncGmail}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sincronizar ahora</span>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Layers
                  className="h-4 w-4 text-indigo-500"
                  aria-hidden="true"
                />
                <CardTitle>Módulos Life OS</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {modules.length === 0 ? (
                <p className="sb-text-secondary text-xs">
                  Sin módulos registrados.
                </p>
              ) : (
                <ul className="space-y-2">
                  {modules.map((mod) => (
                    <li
                      key={mod.id}
                      className="sb-elevated flex items-center justify-between rounded-xl border px-3.5 py-2.5"
                    >
                      <span className="sb-text-primary text-sm font-medium capitalize">
                        {mod.moduleKey}
                      </span>
                      <Button
                        variant={mod.enabled ? "success" : "secondary"}
                        size="sm"
                        loading={togglingModule === mod.moduleKey}
                        onClick={() => void handleToggleModule(mod)}
                      >
                        {mod.enabled ? "Activo" : "Inactivo"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Audit Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <div>
              <CardTitle>Registro de Auditoría</CardTitle>
              <CardDescription>
                Historial inmutable de operaciones recientes
              </CardDescription>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={loadingLogs}
            onClick={refreshAuditLogs}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Actualizar</span>
          </Button>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="sb-text-secondary py-4 text-center text-xs">
              Aún no hay eventos en el registro de auditoría.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)] text-xs">
              {auditLogs.map((log) => (
                <li
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent">{log.action}</Badge>
                    <span className="sb-text-primary font-medium">
                      {log.entityType}
                    </span>
                    <span className="sb-text-muted font-mono text-[11px]">
                      {log.entityId.slice(0, 12)}
                    </span>
                  </div>
                  <span className="sb-text-muted tabular-nums">
                    {formatDateTime(log.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
