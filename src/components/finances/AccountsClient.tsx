"use client";

import { useState } from "react";
import {
  Archive,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { apiFetch } from "@/lib/ui/api-client";
import { formatMoney, normalizeDecimalInput } from "@/lib/ui/format";
import type { SerializedFinancialAccount } from "@/modules/finances/serializers";
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

type AccountType = SerializedFinancialAccount["type"];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK: "Banco",
  CASH: "Efectivo",
  CREDIT_CARD: "Tarjeta de crédito",
};

interface AccountFormState {
  name: string;
  type: AccountType;
  currency: string;
  balance: string;
  creditLimit: string;
  statementClosingDay: string;
  paymentDueDay: string;
  institution: string;
  lastFour: string;
}

const EMPTY_FORM: AccountFormState = {
  name: "",
  type: "BANK",
  currency: "USD",
  balance: "0.00",
  creditLimit: "",
  statementClosingDay: "",
  paymentDueDay: "",
  institution: "",
  lastFour: "",
};

export function AccountsClient({
  initialAccounts,
  defaultCurrency,
}: {
  initialAccounts: SerializedFinancialAccount[];
  defaultCurrency: string;
}) {
  const [accounts, setAccounts] =
    useState<SerializedFinancialAccount[]>(initialAccounts);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedFinancialAccount | null>(
    null,
  );
  const [form, setForm] = useState<AccountFormState>({
    ...EMPTY_FORM,
    currency: defaultCurrency,
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const reloadAccounts = async (showArchived = includeArchived) => {
    const res = await apiFetch<SerializedFinancialAccount[]>(
      `/api/finances/accounts?includeArchived=${showArchived ? "true" : "false"}`,
    );
    setAccounts(res.data);
  };

  const handleToggleArchived = async () => {
    const next = !includeArchived;
    setIncludeArchived(next);
    try {
      await reloadAccounts(next);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error cargando cuentas.",
      });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, currency: defaultCurrency });
    setModalOpen(true);
  };

  const openEdit = (account: SerializedFinancialAccount) => {
    setEditing(account);
    setForm({
      name: account.name,
      type: account.type,
      currency: account.currency,
      balance: account.balance,
      creditLimit: account.creditLimit ?? "",
      statementClosingDay:
        account.statementClosingDay != null
          ? String(account.statementClosingDay)
          : "",
      paymentDueDay:
        account.paymentDueDay != null ? String(account.paymentDueDay) : "",
      institution: account.institution ?? "",
      lastFour: account.lastFour ?? "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const creditLimitVal = normalizeDecimalInput(form.creditLimit);
      const closingDay = form.statementClosingDay.trim()
        ? Number(form.statementClosingDay)
        : null;
      const dueDay = form.paymentDueDay.trim()
        ? Number(form.paymentDueDay)
        : null;

      if (editing) {
        // PATCH /api/finances/accounts/[id] is .strict() and MUST NOT include balance
        await apiFetch(`/api/finances/accounts/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            type: form.type,
            currency: form.currency.trim().toUpperCase(),
            creditLimit:
              form.type === "CREDIT_CARD" && creditLimitVal
                ? creditLimitVal
                : null,
            statementClosingDay: form.type === "CREDIT_CARD" ? closingDay : null,
            paymentDueDay: form.type === "CREDIT_CARD" ? dueDay : null,
            institution: form.institution.trim() || null,
            lastFour: form.lastFour.trim() || null,
          }),
        });
        setFeedback({ type: "success", text: "Cuenta actualizada correctamente." });
      } else {
        const balanceVal = normalizeDecimalInput(form.balance) || "0";
        await apiFetch("/api/finances/accounts", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            type: form.type,
            currency: form.currency.trim().toUpperCase(),
            balance: balanceVal,
            creditLimit:
              form.type === "CREDIT_CARD" && creditLimitVal
                ? creditLimitVal
                : null,
            statementClosingDay: form.type === "CREDIT_CARD" ? closingDay : null,
            paymentDueDay: form.type === "CREDIT_CARD" ? dueDay : null,
            institution: form.institution.trim() || null,
            lastFour: form.lastFour.trim() || null,
          }),
        });
        setFeedback({ type: "success", text: "Cuenta creada correctamente." });
      }

      setModalOpen(false);
      await reloadAccounts(includeArchived);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "No se pudo guardar la cuenta.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (account: SerializedFinancialAccount) => {
    setFeedback(null);
    setBusyId(account.id);
    try {
      await apiFetch(`/api/finances/accounts/${account.id}`, {
        method: "DELETE",
      });
      await reloadAccounts(includeArchived);
      setFeedback({
        type: "info",
        text: `Cuenta "${account.name}" archivada.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error al archivar cuenta.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (account: SerializedFinancialAccount) => {
    setFeedback(null);
    setBusyId(account.id);
    try {
      await apiFetch(`/api/finances/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: false }),
      });
      await reloadAccounts(includeArchived);
      setFeedback({
        type: "success",
        text: `Cuenta "${account.name}" restaurada.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error al restaurar cuenta.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="sb-text-secondary inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={handleToggleArchived}
            className="h-4 w-4 rounded accent-indigo-600"
          />
          <span>Mostrar cuentas archivadas</span>
        </label>

        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nueva cuenta</span>
        </Button>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-5 w-5" />}
          title="No hay cuentas registradas"
          description="Crea cuentas bancarias, de efectivo o tarjetas de crédito para llevar el control exacto de tu patrimonio."
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Crear primera cuenta</span>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => {
            const Icon =
              account.type === "CREDIT_CARD"
                ? CreditCard
                : account.type === "BANK"
                  ? Landmark
                  : Wallet;

            return (
              <Card
                key={account.id}
                className={account.isArchived ? "opacity-70" : ""}
              >
                <CardHeader>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{account.name}</CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="accent">
                          {ACCOUNT_TYPE_LABELS[account.type]}
                        </Badge>
                        {account.isArchived ? (
                          <Badge variant="warning">Archivada</Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div>
                    <p className="sb-text-muted text-xs">Saldo actual</p>
                    <p className="sb-text-primary mt-0.5 text-2xl font-bold tabular-nums">
                      {formatMoney(account.balance, account.currency)}
                    </p>
                  </div>

                  <dl className="sb-elevated grid grid-cols-2 gap-2 rounded-xl border p-3 text-xs">
                    <div>
                      <dt className="sb-text-muted">Moneda</dt>
                      <dd className="sb-text-primary font-medium">
                        {account.currency}
                      </dd>
                    </div>
                    <div>
                      <dt className="sb-text-muted">Institución</dt>
                      <dd className="sb-text-primary truncate font-medium">
                        {account.institution || "—"}
                        {account.lastFour ? ` · ••${account.lastFour}` : ""}
                      </dd>
                    </div>
                    {account.type === "CREDIT_CARD" ? (
                      <>
                        <div>
                          <dt className="sb-text-muted">Límite crédito</dt>
                          <dd className="sb-text-primary font-medium tabular-nums">
                            {account.creditLimit
                              ? formatMoney(account.creditLimit, account.currency)
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="sb-text-muted">Disponible</dt>
                          <dd className="text-emerald-500 font-medium tabular-nums">
                            {account.availableCredit
                              ? formatMoney(
                                  account.availableCredit,
                                  account.currency,
                                )
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="sb-text-muted">Día corte</dt>
                          <dd className="sb-text-primary font-medium">
                            {account.statementClosingDay ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="sb-text-muted">Día pago</dt>
                          <dd className="sb-text-primary font-medium">
                            {account.paymentDueDay ?? "—"}
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEdit(account)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Editar</span>
                    </Button>
                    {account.isArchived ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === account.id}
                        onClick={() => handleRestore(account)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Restaurar</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === account.id}
                        onClick={() => handleArchive(account)}
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Archivar</span>
                      </Button>
                    )}
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
        title={editing ? "Editar cuenta" : "Nueva cuenta financiera"}
        description={
          editing
            ? "Los saldos se actualizan mediante movimientos y transferencias."
            : "Para tarjetas de crédito, un saldo negativo representa deuda actual."
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="account-name"
            label="Nombre"
            required
            placeholder="Ej. Banco Principal, Visa Platinum"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="account-type"
              label="Tipo"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as AccountType })
              }
            >
              <option value="BANK">Banco</option>
              <option value="CASH">Efectivo</option>
              <option value="CREDIT_CARD">Tarjeta de crédito</option>
            </Select>

            <Input
              id="account-currency"
              label="Moneda (ISO 3)"
              required
              maxLength={3}
              placeholder="USD"
              value={form.currency}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value.toUpperCase() })
              }
            />
          </div>

          {!editing ? (
            <Input
              id="account-balance"
              label="Saldo inicial"
              required
              placeholder="0.00"
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
              hint="Usa signo negativo para deuda inicial en tarjetas de crédito (ej. -350.00)."
            />
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="account-institution"
              label="Institución (opcional)"
              placeholder="Ej. Chase, Bancolombia"
              value={form.institution}
              onChange={(e) =>
                setForm({ ...form, institution: e.target.value })
              }
            />
            <Input
              id="account-last4"
              label="Últimos 4 dígitos (opcional)"
              maxLength={4}
              placeholder="1234"
              value={form.lastFour}
              onChange={(e) => setForm({ ...form, lastFour: e.target.value })}
            />
          </div>

          {form.type === "CREDIT_CARD" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                id="account-limit"
                label="Límite de crédito"
                placeholder="5000.00"
                value={form.creditLimit}
                onChange={(e) =>
                  setForm({ ...form, creditLimit: e.target.value })
                }
              />
              <Input
                id="account-closing"
                label="Día de corte"
                type="number"
                min={1}
                max={31}
                placeholder="15"
                value={form.statementClosingDay}
                onChange={(e) =>
                  setForm({ ...form, statementClosingDay: e.target.value })
                }
              />
              <Input
                id="account-due"
                label="Día de pago"
                type="number"
                min={1}
                max={31}
                placeholder="25"
                value={form.paymentDueDay}
                onChange={(e) =>
                  setForm({ ...form, paymentDueDay: e.target.value })
                }
              />
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Guardar cambios" : "Crear cuenta"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
