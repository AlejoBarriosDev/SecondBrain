"use client";

import { useState } from "react";
import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/ui/api-client";
import {
  formatDate,
  formatMoney,
  normalizeDecimalInput,
  toDateInputValue,
} from "@/lib/ui/format";
import type {
  SerializedCategory,
  SerializedFinancialAccount,
  SerializedRecurringRule,
} from "@/modules/finances/serializers";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FeedbackBanner,
  type FeedbackMessage,
} from "@/components/ui/FeedbackBanner";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

type Frequency = SerializedRecurringRule["frequency"];

const FREQUENCY_LABELS: Record<Frequency, string> = {
  DAILY: "Diaria",
  WEEKLY: "Semanal",
  BIWEEKLY: "Quincenal",
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  YEARLY: "Anual",
};

interface RuleFormState {
  name: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: string;
  accountId: string;
  counterpartyAccountId: string;
  categoryId: string;
  frequency: Frequency;
  interval: string;
  startDate: string;
  nextRunAt: string;
  autoPost: boolean;
  isActive: boolean;
  merchant: string;
}

export function RecurringClient({
  initialRules,
  accounts,
  categories,
}: {
  initialRules: SerializedRecurringRule[];
  accounts: SerializedFinancialAccount[];
  categories: SerializedCategory[];
}) {
  const [rules, setRules] = useState<SerializedRecurringRule[]>(initialRules);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedRecurringRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const [form, setForm] = useState<RuleFormState>({
    name: "",
    type: "EXPENSE",
    amount: "",
    accountId: accounts[0]?.id ?? "",
    counterpartyAccountId: accounts[1]?.id ?? "",
    categoryId: "",
    frequency: "MONTHLY",
    interval: "1",
    startDate: toDateInputValue(),
    nextRunAt: toDateInputValue(),
    autoPost: true,
    isActive: true,
    merchant: "",
  });

  const reloadRules = async () => {
    const res = await apiFetch<SerializedRecurringRule[]>(
      "/api/finances/recurring",
    );
    setRules(res.data);
  };

  const openCreate = () => {
    setEditing(null);
    const today = toDateInputValue();
    setForm({
      name: "",
      type: "EXPENSE",
      amount: "",
      accountId: accounts[0]?.id ?? "",
      counterpartyAccountId: accounts[1]?.id ?? "",
      categoryId: "",
      frequency: "MONTHLY",
      interval: "1",
      startDate: today,
      nextRunAt: today,
      autoPost: true,
      isActive: true,
      merchant: "",
    });
    setModalOpen(true);
  };

  const openEdit = (rule: SerializedRecurringRule) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      type: rule.type,
      amount: rule.amount,
      accountId: rule.accountId,
      counterpartyAccountId: rule.counterpartyAccountId ?? "",
      categoryId: rule.categoryId ?? "",
      frequency: rule.frequency,
      interval: String(rule.interval),
      startDate: toDateInputValue(rule.startDate),
      nextRunAt: toDateInputValue(rule.nextRunAt),
      autoPost: rule.autoPost,
      isActive: rule.isActive,
      merchant: rule.merchant ?? "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        amount: normalizeDecimalInput(form.amount),
        accountId: form.accountId,
        counterpartyAccountId:
          form.type === "TRANSFER" ? form.counterpartyAccountId || null : null,
        categoryId: form.categoryId || null,
        frequency: form.frequency,
        interval: Math.max(1, Number(form.interval) || 1),
        startDate: new Date(`${form.startDate}T12:00:00.000Z`).toISOString(),
        nextRunAt: new Date(`${form.nextRunAt}T12:00:00.000Z`).toISOString(),
        autoPost: form.autoPost,
        isActive: form.isActive,
        merchant: form.merchant.trim() || null,
      };

      if (editing) {
        await apiFetch(`/api/finances/recurring/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", text: "Regla recurrente actualizada." });
      } else {
        await apiFetch("/api/finances/recurring", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", text: "Regla recurrente creada." });
      }

      setModalOpen(false);
      await reloadRules();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error guardando regla.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rule: SerializedRecurringRule) => {
    setFeedback(null);
    setBusyId(rule.id);
    try {
      await apiFetch(`/api/finances/recurring/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      await reloadRules();
      setFeedback({
        type: "info",
        text: rule.isActive ? "Regla pausada." : "Regla activada.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error actualizando regla.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rule: SerializedRecurringRule) => {
    setFeedback(null);
    setBusyId(rule.id);
    try {
      await apiFetch(`/api/finances/recurring/${rule.id}`, {
        method: "DELETE",
      });
      await reloadRules();
      setFeedback({ type: "info", text: `Regla "${rule.name}" eliminada.` });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error eliminando regla.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRunDue = async () => {
    setFeedback(null);
    setRunning(true);
    try {
      const res = await apiFetch<{
        processedCount: number;
        skippedCount: number;
      }>("/api/finances/recurring/run", { method: "POST" });
      await reloadRules();
      const processed = res.data.processedCount ?? 0;
      const skipped = res.data.skippedCount ?? 0;
      setFeedback({
        type: "success",
        text:
          skipped > 0
            ? `Ejecución completada: ${processed} regla(s) procesada(s), ${skipped} omitida(s).`
            : `Ejecución completada: ${processed} regla(s) procesada(s).`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error ejecutando reglas.",
      });
    } finally {
      setRunning(false);
    }
  };

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" loading={running} onClick={handleRunDue}>
          <Play className="h-4 w-4" aria-hidden="true" />
          <span>Ejecutar reglas vencidas</span>
        </Button>

        <Button onClick={openCreate} disabled={accounts.length === 0}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nueva regla recurrente</span>
        </Button>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon={<Repeat className="h-5 w-5" />}
          title="Sin suscripciones ni recurrentes"
          description="Programa suscripciones, nóminas o pagos periódicos para mantener tu flujo proyectado."
          action={
            accounts.length > 0 ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Crear regla</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="sb-text-primary text-sm font-semibold">
                        {rule.name}
                      </p>
                      <Badge variant={rule.isActive ? "success" : "default"}>
                        {rule.isActive ? "Activa" : "Pausada"}
                      </Badge>
                      <Badge variant="accent">
                        {FREQUENCY_LABELS[rule.frequency]}
                      </Badge>
                    </div>
                    <p className="sb-text-secondary text-xs">
                      Cuenta: {accountNameById.get(rule.accountId) ?? "—"} ·
                      Próxima ejecución:{" "}
                      <strong className="sb-text-primary">
                        {formatDate(rule.nextRunAt)}
                      </strong>
                      {rule.lastRunAt
                        ? ` · Última: ${formatDate(rule.lastRunAt)}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
                    <p className="sb-text-primary text-base font-bold tabular-nums">
                      {formatMoney(rule.amount, rule.currency)}
                    </p>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === rule.id}
                        onClick={() => handleToggleActive(rule)}
                        aria-label={
                          rule.isActive
                            ? `Pausar ${rule.name}`
                            : `Activar ${rule.name}`
                        }
                      >
                        {rule.isActive ? (
                          <Pause className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                          <Play className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(rule)}
                        aria-label={`Editar ${rule.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === rule.id}
                        onClick={() => handleDelete(rule)}
                        aria-label={`Eliminar ${rule.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar regla recurrente" : "Nueva regla recurrente"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="rec-name"
            label="Nombre"
            required
            placeholder="Ej. Netflix, Alquiler, Nómina"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="rec-type"
              label="Tipo"
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as "EXPENSE" | "INCOME" | "TRANSFER",
                })
              }
            >
              <option value="EXPENSE">Gasto (EXPENSE)</option>
              <option value="INCOME">Ingreso (INCOME)</option>
              <option value="TRANSFER">Transferencia (TRANSFER)</option>
            </Select>

            <Input
              id="rec-amount"
              label="Monto"
              required
              placeholder="15.99"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="rec-account"
              label="Cuenta"
              required
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>

            {form.type === "TRANSFER" ? (
              <Select
                id="rec-counterparty"
                label="Cuenta destino"
                required
                value={form.counterpartyAccountId}
                onChange={(e) =>
                  setForm({ ...form, counterpartyAccountId: e.target.value })
                }
              >
                <option value="">Seleccionar...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            ) : (
              <Select
                id="rec-category"
                label="Categoría (opcional)"
                value={form.categoryId}
                onChange={(e) =>
                  setForm({ ...form, categoryId: e.target.value })
                }
              >
                <option value="">Sin categoría</option>
                {categories
                  .filter((c) => c.type === form.type)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="rec-freq"
              label="Frecuencia"
              value={form.frequency}
              onChange={(e) =>
                setForm({ ...form, frequency: e.target.value as Frequency })
              }
            >
              <option value="DAILY">Diaria</option>
              <option value="WEEKLY">Semanal</option>
              <option value="BIWEEKLY">Quincenal</option>
              <option value="MONTHLY">Mensual</option>
              <option value="QUARTERLY">Trimestral</option>
              <option value="YEARLY">Anual</option>
            </Select>

            <Input
              id="rec-interval"
              label="Intervalo"
              type="number"
              min={1}
              max={365}
              value={form.interval}
              onChange={(e) => setForm({ ...form, interval: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="rec-start"
              label="Fecha inicio"
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
            <Input
              id="rec-next"
              label="Próxima ejecución"
              type="date"
              required
              value={form.nextRunAt}
              onChange={(e) => setForm({ ...form, nextRunAt: e.target.value })}
            />
          </div>

          <Input
            id="rec-merchant"
            label="Comercio (opcional)"
            placeholder="Ej. Spotify"
            value={form.merchant}
            onChange={(e) => setForm({ ...form, merchant: e.target.value })}
          />

          <div className="flex flex-wrap gap-4">
            <label className="sb-text-secondary inline-flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoPost}
                onChange={(e) =>
                  setForm({ ...form, autoPost: e.target.checked })
                }
                className="h-4 w-4 rounded accent-indigo-600"
              />
              <span>Publicar automáticamente (POSTED)</span>
            </label>
            <label className="sb-text-secondary inline-flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
                className="h-4 w-4 rounded accent-indigo-600"
              />
              <span>Regla activa</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Guardar cambios" : "Crear regla"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
