"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, PieChart, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/ui/api-client";
import {
  formatMoney,
  formatPercent,
  normalizeDecimalInput,
} from "@/lib/ui/format";
import type {
  SerializedBudgetWithProgress,
  SerializedCategory,
} from "@/modules/finances/serializers";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FeedbackBanner,
  type FeedbackMessage,
} from "@/components/ui/FeedbackBanner";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function BudgetsClient({
  initialBudgets,
  categories,
  initialYear,
  initialMonth,
  defaultCurrency,
}: {
  initialBudgets: SerializedBudgetWithProgress[];
  categories: SerializedCategory[];
  initialYear: number;
  initialMonth: number;
  defaultCurrency: string;
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [budgets, setBudgets] =
    useState<SerializedBudgetWithProgress[]>(initialBudgets);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const expenseCategories = categories.filter((c) => c.type === "EXPENSE");
  const [categoryId, setCategoryId] = useState(expenseCategories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [alertThresholdPct, setAlertThresholdPct] = useState("80");
  const [rollover, setRollover] = useState(false);

  const loadMonth = async (targetYear: number, targetMonth: number) => {
    setLoadingMonth(true);
    try {
      const res = await apiFetch<SerializedBudgetWithProgress[]>(
        `/api/finances/budgets?year=${targetYear}&month=${targetMonth}`,
      );
      setYear(targetYear);
      setMonth(targetMonth);
      setBudgets(res.data);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error cargando presupuestos.",
      });
    } finally {
      setLoadingMonth(false);
    }
  };

  const shiftMonth = (delta: number) => {
    let nextMonth = month + delta;
    let nextYear = year;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    void loadMonth(nextYear, nextMonth);
  };

  const handleUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      await apiFetch("/api/finances/budgets", {
        method: "POST",
        body: JSON.stringify({
          categoryId,
          year,
          month,
          amount: normalizeDecimalInput(amount),
          currency: currency.trim().toUpperCase(),
          alertThresholdPct: Number(alertThresholdPct) || 80,
          rollover,
        }),
      });
      setModalOpen(false);
      setAmount("");
      await loadMonth(year, month);
      setFeedback({ type: "success", text: "Presupuesto guardado." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error guardando presupuesto.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setFeedback(null);
    setBusyId(id);
    try {
      await apiFetch(`/api/finances/budgets/${id}`, { method: "DELETE" });
      await loadMonth(year, month);
      setFeedback({ type: "info", text: "Presupuesto eliminado." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error eliminando presupuesto.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="sb-surface inline-flex items-center gap-2 rounded-xl border px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shiftMonth(-1)}
            disabled={loadingMonth}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="sb-text-primary min-w-36 text-center text-sm font-semibold">
            {MONTHS[month - 1]} {year}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shiftMonth(1)}
            disabled={loadingMonth}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Definir presupuesto</span>
        </Button>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart className="h-5 w-5" />}
          title={`Sin presupuestos para ${MONTHS[month - 1]} ${year}`}
          description="Asigna límites mensuales por categoría y recibe alertas al alcanzar el 80% o superar el 100%."
          action={
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Crear presupuesto</span>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {budgets.map((b) => {
            const barWidth = Math.min(100, Math.max(0, b.percentUsed));
            const barColor =
              b.alertStatus === "EXCEEDED"
                ? "bg-rose-500"
                : b.alertStatus === "WARNING"
                  ? "bg-amber-500"
                  : "bg-emerald-500";
            const badgeVariant =
              b.alertStatus === "EXCEEDED"
                ? "danger"
                : b.alertStatus === "WARNING"
                  ? "warning"
                  : "success";

            return (
              <Card key={b.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{b.category.name}</CardTitle>
                    <p className="sb-text-muted mt-0.5 text-xs">
                      Alerta al {b.alertThresholdPct}%
                      {b.rollover ? " · Rollover activo" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={badgeVariant}>
                      {b.alertStatus} · {formatPercent(b.percentUsed)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === b.id}
                      onClick={() => handleDelete(b.id)}
                      aria-label={`Eliminar presupuesto de ${b.category.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-500/20">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="sb-text-secondary">
                      Gastado:{" "}
                      <strong className="sb-text-primary">
                        {formatMoney(b.spent, b.currency)}
                      </strong>
                    </span>
                    <span className="sb-text-secondary">
                      Límite:{" "}
                      <strong className="sb-text-primary">
                        {formatMoney(b.amount, b.currency)}
                      </strong>
                    </span>
                    <span className="sb-text-secondary">
                      Restante:{" "}
                      <strong
                        className={
                          Number(b.remaining) < 0
                            ? "text-rose-500"
                            : "text-emerald-500"
                        }
                      >
                        {formatMoney(b.remaining, b.currency)}
                      </strong>
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Presupuesto · ${MONTHS[month - 1]} ${year}`}
      >
        <form onSubmit={handleUpsert} className="space-y-4">
          <Select
            id="budget-category"
            label="Categoría de gasto"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="budget-amount"
              label="Límite mensual"
              required
              placeholder="500.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              id="budget-currency"
              label="Moneda"
              required
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>

          <Input
            id="budget-threshold"
            label="Umbral de alerta (%)"
            type="number"
            min={1}
            max={100}
            value={alertThresholdPct}
            onChange={(e) => setAlertThresholdPct(e.target.value)}
          />

          <label className="sb-text-secondary inline-flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={rollover}
              onChange={(e) => setRollover(e.target.checked)}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            <span>Permitir acumulación (rollover)</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar presupuesto
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
