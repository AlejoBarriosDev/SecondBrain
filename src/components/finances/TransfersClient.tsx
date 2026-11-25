"use client";

import { useState } from "react";
import { ArrowLeftRight, ArrowRight, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/ui/api-client";
import {
  formatDate,
  formatMoney,
  normalizeDecimalInput,
  toDateInputValue,
} from "@/lib/ui/format";
import type { SerializedFinancialAccount } from "@/modules/finances/serializers";
import type { TransferListItem } from "@/modules/finances/transfers";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FeedbackBanner,
  type FeedbackMessage,
} from "@/components/ui/FeedbackBanner";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export function TransfersClient({
  initialTransfers,
  accounts,
}: {
  initialTransfers: TransferListItem[];
  accounts: SerializedFinancialAccount[];
}) {
  const [transfers, setTransfers] =
    useState<TransferListItem[]>(initialTransfers);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(
    accounts[1]?.id ?? accounts[0]?.id ?? "",
  );
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [occurredAt, setOccurredAt] = useState(toDateInputValue());
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  const fromAcc = accounts.find((a) => a.id === fromAccountId);
  const toAcc = accounts.find((a) => a.id === toAccountId);
  const isCrossCurrency = Boolean(
    fromAcc && toAcc && fromAcc.currency !== toAcc.currency,
  );

  const reloadTransfers = async () => {
    const res = await apiFetch<TransferListItem[]>(
      "/api/finances/transfers?page=1&pageSize=50",
    );
    setTransfers(res.data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        fromAccountId,
        toAccountId,
        amount: normalizeDecimalInput(amount),
        occurredAt: new Date(`${occurredAt}T12:00:00.000Z`).toISOString(),
        description: description.trim() || "Transferencia entre cuentas",
        notes: notes.trim() || null,
      };
      if (isCrossCurrency && normalizeDecimalInput(toAmount)) {
        payload.toAmount = normalizeDecimalInput(toAmount);
      }
      if (isCrossCurrency && normalizeDecimalInput(exchangeRate)) {
        payload.exchangeRate = normalizeDecimalInput(exchangeRate);
      }

      await apiFetch("/api/finances/transfers", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setModalOpen(false);
      setAmount("");
      setToAmount("");
      setExchangeRate("");
      setDescription("");
      setNotes("");
      await reloadTransfers();
      setFeedback({
        type: "success",
        text: "Transferencia registrada atómicamente (bloqueo FOR UPDATE).",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Error registrando transferencia.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReverse = async (transferGroupId: string) => {
    setFeedback(null);
    setBusyId(transferGroupId);
    try {
      await apiFetch(`/api/finances/transfers/${transferGroupId}`, {
        method: "DELETE",
      });
      await reloadTransfers();
      setFeedback({
        type: "info",
        text: "Transferencia revertida y saldos restaurados.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Error revirtiendo transferencia.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setModalOpen(true)} disabled={accounts.length < 2}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nueva transferencia</span>
        </Button>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {transfers.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight className="h-5 w-5" />}
          title="Sin transferencias registradas"
          description={
            accounts.length < 2
              ? "Necesitas al menos 2 cuentas activas para realizar transferencias."
              : "Mueve fondos entre bancos, efectivo o pagos de tarjeta de crédito sin distorsionar tus ingresos o gastos."
          }
          action={
            accounts.length >= 2 ? (
              <Button onClick={() => setModalOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Crear transferencia</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {transfers.map((tr) => (
                <li
                  key={tr.transferGroupId}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="sb-text-primary text-sm font-semibold">
                      {tr.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="default">
                        {tr.outTransaction.account?.name ?? "Origen"}
                      </Badge>
                      <ArrowRight
                        className="sb-text-muted h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      <Badge variant="accent">
                        {tr.inTransaction?.account?.name ?? "Destino"}
                      </Badge>
                      <span className="sb-text-muted">
                        · {formatDate(tr.occurredAt)}
                      </span>
                      {tr.outTransaction.exchangeRate ? (
                        <Badge variant="info">
                          FX: {tr.outTransaction.exchangeRate}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
                    <div className="text-right tabular-nums">
                      <p className="sb-text-primary text-sm font-bold">
                        {formatMoney(
                          tr.outTransaction.amount,
                          tr.outTransaction.currency,
                        )}
                      </p>
                      {tr.inTransaction &&
                      tr.inTransaction.currency !== tr.outTransaction.currency ? (
                        <p className="text-emerald-500 text-xs font-medium">
                          →{" "}
                          {formatMoney(
                            tr.inTransaction.amount,
                            tr.inTransaction.currency,
                          )}
                        </p>
                      ) : null}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === tr.transferGroupId}
                      onClick={() => handleReverse(tr.transferGroupId)}
                      aria-label={`Revertir ${tr.description}`}
                      title="Revertir transferencia"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
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
        title="Nueva transferencia"
        description="Genera dos piernas enlazadas (OUT/IN) y actualiza ambos saldos de forma atómica."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="tr-from"
              label="Cuenta origen"
              required
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>

            <Select
              id="tr-to"
              label="Cuenta destino"
              required
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="tr-amount"
              label={`Monto origen (${fromAcc?.currency ?? "USD"})`}
              required
              placeholder="250.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              id="tr-date"
              label="Fecha"
              type="date"
              required
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          {isCrossCurrency ? (
            <div className="sb-elevated grid grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-2">
              <Input
                id="tr-to-amount"
                label={`Monto destino (${toAcc?.currency})`}
                placeholder="Opcional si indicas tasa"
                value={toAmount}
                onChange={(e) => setToAmount(e.target.value)}
              />
              <Input
                id="tr-fx"
                label="Tasa de cambio"
                placeholder="Ej. 0.92"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
              />
            </div>
          ) : null}

          <Input
            id="tr-desc"
            label="Descripción"
            placeholder="Ej. Pago tarjeta Visa"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <Textarea
            id="tr-notes"
            label="Notas (opcional)"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Transferir
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
