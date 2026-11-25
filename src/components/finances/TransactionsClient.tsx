"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  Download,
  Pencil,
  Plus,
  Receipt,
  Search,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
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
  SerializedTagSummary,
  SerializedTransaction,
} from "@/modules/finances/serializers";
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

interface TxFormState {
  accountId: string;
  categoryId: string;
  type: "EXPENSE" | "INCOME";
  amount: string;
  occurredAt: string;
  description: string;
  merchant: string;
  notes: string;
  status: "POSTED" | "PENDING";
  tagIds: string[];
}

export function TransactionsClient({
  initialItems,
  initialMeta,
  accounts,
  categories,
  initialTags,
}: {
  initialItems: SerializedTransaction[];
  initialMeta: { total: number; page: number; pageSize: number };
  accounts: SerializedFinancialAccount[];
  categories: SerializedCategory[];
  initialTags: SerializedTagSummary[];
}) {
  const [items, setItems] = useState<SerializedTransaction[]>(initialItems);
  const [meta, setMeta] = useState(initialMeta);
  const [tags, setTags] = useState<SerializedTagSummary[]>(initialTags);

  // Filters
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tagIdFilter, setTagIdFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState("");
  const [loadingList, setLoadingList] = useState(false);

  // Modal & Form
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  // Inline tag creator
  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  const defaultAccountId = accounts[0]?.id ?? "";
  const [form, setForm] = useState<TxFormState>({
    accountId: defaultAccountId,
    categoryId: "",
    type: "EXPENSE",
    amount: "",
    occurredAt: toDateInputValue(),
    description: "",
    merchant: "",
    notes: "",
    status: "POSTED",
    tagIds: [],
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setEditing(null);
      setModalOpen(true);
    }
  }, []);

  const buildFilterParams = (page = 1) => {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (categoryId) params.set("categoryId", categoryId);
    if (typeFilter) params.set("type", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (tagIdFilter) params.set("tagId", tagIdFilter);
    if (fromDate) params.set("from", `${fromDate}T00:00:00.000Z`);
    if (toDate) params.set("to", `${toDate}T23:59:59.999Z`);
    if (query.trim()) params.set("q", query.trim());
    params.set("page", String(page));
    params.set("pageSize", String(meta.pageSize));
    return params;
  };

  const fetchTransactions = async (page = 1) => {
    setLoadingList(true);
    try {
      const params = buildFilterParams(page);
      const res = await apiFetch<SerializedTransaction[]>(
        `/api/finances/transactions?${params.toString()}`,
      );
      setItems(res.data);
      if (res.meta) {
        setMeta(res.meta);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error cargando movimientos.",
      });
    } finally {
      setLoadingList(false);
    }
  };

  const buildExportHref = (format: "csv" | "json") => {
    const params = buildFilterParams(1);
    params.delete("page");
    params.delete("pageSize");
    params.set("format", format);
    return `/api/finances/export?${params.toString()}`;
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      accountId: accounts[0]?.id ?? "",
      categoryId: "",
      type: "EXPENSE",
      amount: "",
      occurredAt: toDateInputValue(),
      description: "",
      merchant: "",
      notes: "",
      status: "POSTED",
      tagIds: [],
    });
    setModalOpen(true);
  };

  const openEdit = (tx: SerializedTransaction) => {
    if (tx.type === "TRANSFER") return;
    setEditing(tx);
    setForm({
      accountId: tx.accountId,
      categoryId: tx.categoryId ?? "",
      type: tx.type === "INCOME" ? "INCOME" : "EXPENSE",
      amount: tx.amount,
      occurredAt: toDateInputValue(tx.occurredAt),
      description: tx.description,
      merchant: tx.merchant ?? "",
      notes: tx.notes ?? "",
      status: tx.status === "PENDING" ? "PENDING" : "POSTED",
      tagIds: tx.tags?.map((t) => t.id) ?? [],
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const payload = {
        accountId: form.accountId,
        categoryId: form.categoryId || null,
        type: form.type,
        amount: normalizeDecimalInput(form.amount),
        occurredAt: new Date(`${form.occurredAt}T12:00:00.000Z`).toISOString(),
        description: form.description.trim(),
        merchant: form.merchant.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        tagIds: form.tagIds,
      };

      if (editing) {
        await apiFetch(`/api/finances/transactions/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", text: "Movimiento actualizado." });
      } else {
        await apiFetch("/api/finances/transactions", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", text: "Movimiento registrado." });
      }

      setModalOpen(false);
      await fetchTransactions(meta.page);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error guardando movimiento.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async (tx: SerializedTransaction) => {
    setFeedback(null);
    setBusyId(tx.id);
    try {
      await apiFetch(`/api/finances/transactions/${tx.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "VOID" }),
      });
      await fetchTransactions(meta.page);
      setFeedback({ type: "info", text: "Movimiento anulado (VOID)." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error anulando movimiento.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (tx: SerializedTransaction) => {
    setFeedback(null);
    setBusyId(tx.id);
    try {
      await apiFetch(`/api/finances/transactions/${tx.id}`, {
        method: "DELETE",
      });
      await fetchTransactions(meta.page);
      setFeedback({ type: "info", text: "Movimiento eliminado." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error eliminando movimiento.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    try {
      const res = await apiFetch<SerializedTagSummary>("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: newTagName.trim(), color: "#6366f1" }),
      });
      setTags((prev) => [...prev, res.data]);
      setForm((prev) => ({ ...prev, tagIds: [...prev.tagIds, res.data.id] }));
      setNewTagName("");
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error creando etiqueta.",
      });
    } finally {
      setCreatingTag(false);
    }
  };

  const toggleTagInForm = (id: string) => {
    setForm((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(id)
        ? prev.tagIds.filter((t) => t !== id)
        : [...prev.tagIds, id],
    }));
  };

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const filteredCategoriesForForm = categories.filter(
    (c) => c.type === form.type,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={buildExportHref("csv")}
            download
            className="sb-elevated sb-text-primary inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Exportar CSV</span>
          </a>
          <a
            href={buildExportHref("json")}
            download
            className="sb-elevated sb-text-primary inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Exportar JSON</span>
          </a>
        </div>

        <Button onClick={openCreate} disabled={accounts.length === 0}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nuevo movimiento</span>
        </Button>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {/* Filters */}
      <Card>
        <CardContent className="pt-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void fetchTransactions(1);
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Input
              id="filter-q"
              label="Buscar"
              placeholder="Descripción, comercio..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              id="filter-account"
              label="Cuenta"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
            <Select
              id="filter-category"
              label="Categoría"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              id="filter-type"
              label="Tipo"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="EXPENSE">Gasto</option>
              <option value="INCOME">Ingreso</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
            <Select
              id="filter-status"
              label="Estado"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="POSTED">POSTED</option>
              <option value="PENDING">PENDING</option>
              <option value="VOID">VOID</option>
            </Select>
            <Select
              id="filter-tag"
              label="Etiqueta"
              value={tagIdFilter}
              onChange={(e) => setTagIdFilter(e.target.value)}
            >
              <option value="">Todas</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name}
                </option>
              ))}
            </Select>
            <Input
              id="filter-from"
              label="Desde"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <Input
              id="filter-to"
              label="Hasta"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit" loading={loadingList}>
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Aplicar filtros</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setAccountId("");
                  setCategoryId("");
                  setTypeFilter("");
                  setStatusFilter("");
                  setTagIdFilter("");
                  setFromDate("");
                  setToDate("");
                  setQuery("");
                  void apiFetch<SerializedTransaction[]>(
                    `/api/finances/transactions?page=1&pageSize=${meta.pageSize}`,
                  ).then((res) => {
                    setItems(res.data);
                    if (res.meta) setMeta(res.meta);
                  });
                }}
              >
                Limpiar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-5 w-5" />}
          title="Sin movimientos"
          description="No se encontraron transacciones con los filtros actuales."
          action={
            accounts.length > 0 ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Registrar movimiento</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {items.map((tx) => {
                const isPositive =
                  tx.type === "INCOME" ||
                  (tx.type === "TRANSFER" && tx.transferDirection === "IN");
                const sign = isPositive ? "+" : "-";
                const isTransfer = tx.type === "TRANSFER";

                return (
                  <li
                    key={tx.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="sb-text-primary truncate text-sm font-semibold">
                          {tx.description}
                        </p>
                        <Badge
                          variant={
                            tx.status === "VOID"
                              ? "danger"
                              : tx.status === "PENDING"
                                ? "warning"
                                : tx.type === "INCOME"
                                  ? "success"
                                  : isTransfer
                                    ? "info"
                                    : "default"
                          }
                        >
                          {tx.status === "VOID" ? "VOID" : tx.type}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="sb-text-muted">
                          {formatDate(tx.occurredAt)}
                        </span>
                        {tx.account ? (
                          <span className="sb-text-secondary">
                            · {tx.account.name}
                          </span>
                        ) : null}
                        {tx.category ? (
                          <Badge variant="accent">{tx.category.name}</Badge>
                        ) : null}
                        {tx.merchant ? (
                          <span className="sb-text-muted">· {tx.merchant}</span>
                        ) : null}
                        {tx.tags?.map((t) => (
                          <Badge key={t.id} variant="default">
                            #{t.name}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
                      <p
                        className={`text-base font-bold tabular-nums ${
                          tx.status === "VOID"
                            ? "sb-text-muted line-through"
                            : isPositive
                              ? "text-emerald-500"
                              : "sb-text-primary"
                        }`}
                      >
                        {sign}
                        {formatMoney(tx.amount, tx.currency)}
                      </p>

                      {!isTransfer ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(tx)}
                            aria-label={`Editar ${tx.description}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {tx.status !== "VOID" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={busyId === tx.id}
                              onClick={() => handleVoid(tx)}
                              aria-label={`Anular ${tx.description}`}
                              title="Anular (VOID)"
                            >
                              <Ban className="h-3.5 w-3.5 text-amber-500" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyId === tx.id}
                            onClick={() => handleDelete(tx)}
                            aria-label={`Eliminar ${tx.description}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3 text-xs">
              <span className="sb-text-secondary tabular-nums">
                Total: {meta.total} · Página {meta.page} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={meta.page <= 1 || loadingList}
                  onClick={() => void fetchTransactions(meta.page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={meta.page >= totalPages || loadingList}
                  onClick={() => void fetchTransactions(meta.page + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar movimiento" : "Nuevo movimiento"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="tx-type"
              label="Tipo"
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as "EXPENSE" | "INCOME",
                  categoryId: "",
                })
              }
            >
              <option value="EXPENSE">Gasto (EXPENSE)</option>
              <option value="INCOME">Ingreso (INCOME)</option>
            </Select>

            <Select
              id="tx-account"
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
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="tx-amount"
              label="Monto"
              required
              placeholder="45.50"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <Input
              id="tx-date"
              label="Fecha"
              type="date"
              required
              value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            />
          </div>

          <Input
            id="tx-desc"
            label="Descripción"
            required
            placeholder="Ej. Supermercado semanal"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="tx-category"
              label="Categoría (opcional)"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Sin categoría</option>
              {filteredCategoriesForForm.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Input
              id="tx-merchant"
              label="Comercio (opcional)"
              placeholder="Ej. Whole Foods"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            />
          </div>

          <Select
            id="tx-status"
            label="Estado"
            value={form.status}
            onChange={(e) =>
              setForm({
                ...form,
                status: e.target.value as "POSTED" | "PENDING",
              })
            }
          >
            <option value="POSTED">Confirmado (POSTED)</option>
            <option value="PENDING">Pendiente (PENDING)</option>
          </Select>

          <div className="space-y-2">
            <label className="sb-text-secondary text-xs font-medium">
              Etiquetas
            </label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const selected = form.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTagInForm(tag.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      selected
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "sb-elevated sb-text-secondary"
                    }`}
                  >
                    #{tag.name}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Nueva etiqueta..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="sb-input h-8 flex-1 rounded-lg border px-2.5 text-xs"
              />
              <Button
                variant="secondary"
                size="sm"
                loading={creatingTag}
                onClick={handleCreateTag}
              >
                <TagIcon className="h-3 w-3" />
                <span>Crear</span>
              </Button>
            </div>
          </div>

          <Textarea
            id="tx-notes"
            label="Notas (opcional)"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              {editing ? "Guardar cambios" : "Registrar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
