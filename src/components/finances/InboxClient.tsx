"use client";

import { useState } from "react";
import {
  Check,
  FileText,
  Inbox,
  Mail,
  Pencil,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { ApiClientError, apiFetch } from "@/lib/ui/api-client";
import {
  formatDate,
  formatMoney,
  normalizeDecimalInput,
  toDateInputValue,
} from "@/lib/ui/format";
import type { SerializedEmailImportItem } from "@/modules/finances/inbox";
import type {
  SerializedCategory,
  SerializedFinancialAccount,
} from "@/modules/finances/serializers";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FeedbackBanner,
  type FeedbackMessage,
} from "@/components/ui/FeedbackBanner";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

type InboxTab = "PENDING" | "CONFIRMED" | "REJECTED";

interface EditDraft {
  parsedType: "EXPENSE" | "INCOME";
  parsedAmount: string;
  parsedCurrency: string;
  parsedMerchant: string;
  parsedDescription: string;
  parsedDate: string;
  suggestedAccountId: string;
  suggestedCategoryId: string;
}

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo PDF"));
    reader.readAsDataURL(file);
  });
}

export function InboxClient({
  initialItems,
  accounts,
  categories,
  defaultCurrency,
}: {
  initialItems: SerializedEmailImportItem[];
  accounts: SerializedFinancialAccount[];
  categories: SerializedCategory[];
  defaultCurrency: string;
}) {
  const [activeTab, setActiveTab] = useState<InboxTab>("PENDING");
  const [items, setItems] = useState<SerializedEmailImportItem[]>(initialItems);
  const [loadingTab, setLoadingTab] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  // Per-item selected account/category for quick confirmation
  const [selectedAccounts, setSelectedAccounts] = useState<
    Record<string, string>
  >({});
  const [selectedCategories, setSelectedCategories] = useState<
    Record<string, string>
  >({});

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  // Manual Ingest modal
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestSubject, setIngestSubject] = useState("");
  const [ingestFrom, setIngestFrom] = useState("");
  const [ingestBody, setIngestBody] = useState("");
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const loadTab = async (status: InboxTab) => {
    setActiveTab(status);
    setLoadingTab(true);
    setEditingId(null);
    try {
      const res = await apiFetch<SerializedEmailImportItem[]>(
        `/api/inbox?status=${status}`,
      );
      setItems(res.data);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error cargando bandeja.",
      });
    } finally {
      setLoadingTab(false);
    }
  };

  const handleSyncGmail = async () => {
    setFeedback(null);
    setSyncing(true);
    try {
      const res = await apiFetch<{
        synced?: number;
        skipped?: number;
        errors?: string[];
      }>("/api/inbox/sync", { method: "POST" });
      await loadTab("PENDING");
      setFeedback({
        type: "success",
        text: `Sincronización Gmail completada: ${res.data.synced ?? 0} nuevos, ${res.data.skipped ?? 0} omitidos.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "No se pudo sincronizar Gmail. Verifica que tu cuenta Google tenga permiso gmail.readonly.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleManualIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIngesting(true);
    try {
      const payload: Record<string, unknown> = {
        subject: ingestSubject.trim() || null,
        fromAddress: ingestFrom.trim() || null,
        bodyText: ingestBody.trim() || null,
      };
      if (ingestFile) {
        if (ingestFile.size > MAX_PDF_BYTES) {
          setFeedback({
            type: "error",
            text: "El archivo PDF supera el límite máximo de 10 MB.",
          });
          return;
        }
        payload.pdfBase64 = await readFileAsBase64(ingestFile);
        payload.pdfFileName = ingestFile.name;
      }

      await apiFetch("/api/inbox/ingest", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setIngestOpen(false);
      setIngestSubject("");
      setIngestFrom("");
      setIngestBody("");
      setIngestFile(null);
      await loadTab("PENDING");
      setFeedback({
        type: "success",
        text: "Documento procesado por el parser híbrido y enviado a Revisión (PENDING).",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error importando elemento.",
      });
    } finally {
      setIngesting(false);
    }
  };

  const startEdit = (item: SerializedEmailImportItem) => {
    setEditingId(item.id);
    setEditDraft({
      parsedType: item.parsedType === "INCOME" ? "INCOME" : "EXPENSE",
      parsedAmount: item.parsedAmount ?? "",
      parsedCurrency: item.parsedCurrency ?? defaultCurrency,
      parsedMerchant: item.parsedMerchant ?? "",
      parsedDescription: item.parsedDescription ?? item.subject ?? "",
      parsedDate: toDateInputValue(item.parsedDate ?? item.receivedAt),
      suggestedAccountId:
        selectedAccounts[item.id] ??
        item.suggestedAccountId ??
        accounts[0]?.id ??
        "",
      suggestedCategoryId:
        selectedCategories[item.id] ?? item.suggestedCategoryId ?? "",
    });
  };

  const handleSaveEdit = async (itemId: string) => {
    if (!editDraft) return;
    setFeedback(null);
    setBusyId(itemId);
    try {
      const cleanedAmount = normalizeDecimalInput(editDraft.parsedAmount);
      await apiFetch(`/api/inbox/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          parsedType: editDraft.parsedType,
          parsedAmount: cleanedAmount || null,
          parsedCurrency: editDraft.parsedCurrency.trim().toUpperCase() || null,
          parsedMerchant: editDraft.parsedMerchant.trim() || null,
          parsedDescription: editDraft.parsedDescription.trim() || null,
          parsedDate: editDraft.parsedDate
            ? new Date(`${editDraft.parsedDate}T12:00:00.000Z`).toISOString()
            : null,
          suggestedAccountId: editDraft.suggestedAccountId || null,
          suggestedCategoryId: editDraft.suggestedCategoryId || null,
        }),
      });
      setEditingId(null);
      setEditDraft(null);
      await loadTab(activeTab);
      setFeedback({ type: "success", text: "Borrador actualizado." });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error actualizando elemento.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirm = async (item: SerializedEmailImportItem) => {
    setFeedback(null);
    const chosenAccountId =
      selectedAccounts[item.id] ??
      item.suggestedAccountId ??
      accounts[0]?.id ??
      "";
    if (!chosenAccountId) {
      setFeedback({
        type: "error",
        text: "Selecciona o crea una cuenta financiera antes de confirmar.",
      });
      return;
    }

    const chosenCategoryId =
      selectedCategories[item.id] ?? item.suggestedCategoryId ?? null;
    const txType = item.parsedType === "INCOME" ? "INCOME" : "EXPENSE";

    setBusyId(item.id);
    try {
      await apiFetch(`/api/inbox/${item.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          accountId: chosenAccountId,
          categoryId: chosenCategoryId || null,
          type: txType,
          amount: item.parsedAmount ?? undefined,
          currency: item.parsedCurrency ?? undefined,
          description: (
            item.parsedDescription ||
            item.parsedMerchant ||
            item.subject ||
            "Movimiento importado"
          ).slice(0, 255),
          merchant: item.parsedMerchant ?? null,
          occurredAt: item.parsedDate ?? item.receivedAt,
        }),
      });
      await loadTab(activeTab);
      setFeedback({
        type: "success",
        text: "Movimiento confirmado atómicamente y saldo actualizado.",
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        await loadTab(activeTab);
      }
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error al confirmar.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (item: SerializedEmailImportItem) => {
    setFeedback(null);
    setBusyId(item.id);
    try {
      await apiFetch(`/api/inbox/${item.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "Descartado desde Bandeja de Revisión" }),
      });
      await loadTab(activeTab);
      setFeedback({
        type: "info",
        text: "Elemento rechazado sin afectar saldos.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error al rechazar.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Estado de bandeja"
          className="sb-surface inline-flex rounded-xl border p-1"
        >
          {(["PENDING", "CONFIRMED", "REJECTED"] as const).map((tab) => {
            const labels: Record<InboxTab, string> = {
              PENDING: "Pendientes",
              CONFIRMED: "Confirmados",
              REJECTED: "Rechazados",
            };
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={active}
                disabled={loadingTab}
                onClick={() => void loadTab(tab)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "sb-text-secondary hover:text-[var(--text-primary)]"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setIngestOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Importar correo / PDF</span>
          </Button>
          <Button loading={syncing} onClick={handleSyncGmail}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Sincronizar Gmail</span>
          </Button>
        </div>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={
            activeTab === "PENDING"
              ? "Bandeja de revisión vacía"
              : `No hay elementos en estado ${activeTab}`
          }
          description="Sincroniza tu Gmail o importa manualmente un correo o extracto PDF. Ningún saldo se modifica hasta tu confirmación explícita."
          action={
            <Button variant="secondary" onClick={() => setIngestOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Importar manualmente</span>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const isEditing = editingId === item.id && editDraft !== null;
            const effectiveAccountId =
              selectedAccounts[item.id] ??
              item.suggestedAccountId ??
              accounts[0]?.id ??
              "";
            const effectiveCategoryId =
              selectedCategories[item.id] ?? item.suggestedCategoryId ?? "";
            const confidencePct =
              item.confidence != null
                ? Math.round(Number(item.confidence) * 100)
                : null;

            return (
              <Card key={item.id}>
                <CardHeader>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.hasPdfAttachment ? (
                        <FileText
                          className="h-4 w-4 shrink-0 text-amber-500"
                          aria-hidden="true"
                        />
                      ) : (
                        <Mail
                          className="h-4 w-4 shrink-0 text-indigo-500"
                          aria-hidden="true"
                        />
                      )}
                      <CardTitle className="truncate">
                        {item.parsedMerchant ||
                          item.parsedDescription ||
                          item.subject ||
                          "Elemento importado"}
                      </CardTitle>
                      <Badge
                        variant={
                          item.status === "CONFIRMED"
                            ? "success"
                            : item.status === "REJECTED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {item.status}
                      </Badge>
                      <Badge variant="accent">{item.parserSource}</Badge>
                      {item.hasPdfAttachment ? (
                        <Badge variant="info">PDF</Badge>
                      ) : null}
                      {confidencePct !== null ? (
                        <Badge variant="default">
                          Confianza: {confidencePct}%
                        </Badge>
                      ) : null}
                    </div>
                    <p className="sb-text-secondary text-xs">
                      {item.subject ? `Asunto: ${item.subject}` : ""}
                      {item.fromAddress ? ` · De: ${item.fromAddress}` : ""} ·
                      Recibido: {formatDate(item.receivedAt)}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="sb-text-primary text-lg font-bold tabular-nums">
                      {item.parsedAmount
                        ? formatMoney(
                            item.parsedAmount,
                            item.parsedCurrency ?? defaultCurrency,
                          )
                        : "Sin monto"}
                    </p>
                    <p className="sb-text-muted text-xs">
                      {item.parsedType ?? "EXPENSE"} ·{" "}
                      {formatDate(item.parsedDate ?? item.receivedAt)}
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {item.rawSnippet || item.parsedDescription ? (
                    <div className="sb-elevated rounded-xl border px-3.5 py-2.5 text-xs">
                      {item.parsedDescription ? (
                        <p className="sb-text-primary font-medium">
                          {item.parsedDescription}
                        </p>
                      ) : null}
                      {item.rawSnippet ? (
                        <p className="sb-text-secondary mt-1 line-clamp-2">
                          {item.rawSnippet}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {isEditing && editDraft ? (
                    <div className="sb-elevated space-y-3 rounded-xl border p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Select
                          id={`edit-type-${item.id}`}
                          label="Tipo"
                          value={editDraft.parsedType}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              parsedType: e.target.value as
                                | "EXPENSE"
                                | "INCOME",
                            })
                          }
                        >
                          <option value="EXPENSE">Gasto (EXPENSE)</option>
                          <option value="INCOME">Ingreso (INCOME)</option>
                        </Select>
                        <Input
                          id={`edit-amount-${item.id}`}
                          label="Monto"
                          value={editDraft.parsedAmount}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              parsedAmount: e.target.value,
                            })
                          }
                        />
                        <Input
                          id={`edit-currency-${item.id}`}
                          label="Moneda"
                          maxLength={3}
                          value={editDraft.parsedCurrency}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              parsedCurrency: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Input
                          id={`edit-merchant-${item.id}`}
                          label="Comercio"
                          value={editDraft.parsedMerchant}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              parsedMerchant: e.target.value,
                            })
                          }
                        />
                        <Input
                          id={`edit-desc-${item.id}`}
                          label="Descripción"
                          value={editDraft.parsedDescription}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              parsedDescription: e.target.value,
                            })
                          }
                        />
                        <Input
                          id={`edit-date-${item.id}`}
                          label="Fecha"
                          type="date"
                          value={editDraft.parsedDate}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              parsedDate: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Select
                          id={`edit-acc-${item.id}`}
                          label="Cuenta sugerida"
                          value={editDraft.suggestedAccountId}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              suggestedAccountId: e.target.value,
                            })
                          }
                        >
                          <option value="">Seleccionar...</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.currency})
                            </option>
                          ))}
                        </Select>
                        <Select
                          id={`edit-cat-${item.id}`}
                          label="Categoría sugerida"
                          value={editDraft.suggestedCategoryId}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              suggestedCategoryId: e.target.value,
                            })
                          }
                        >
                          <option value="">Sin categoría</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft(null);
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          loading={busyId === item.id}
                          onClick={() => void handleSaveEdit(item.id)}
                        >
                          Guardar borrador
                        </Button>
                      </div>
                    </div>
                  ) : item.status === "PENDING" ? (
                    <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3 lg:flex-row lg:items-end lg:justify-between">
                      <div className="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <Select
                          id={`confirm-acc-${item.id}`}
                          label="Cuenta destino"
                          value={effectiveAccountId}
                          onChange={(e) =>
                            setSelectedAccounts((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Seleccionar cuenta...</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.currency})
                            </option>
                          ))}
                        </Select>

                        <Select
                          id={`confirm-cat-${item.id}`}
                          label="Categoría"
                          value={effectiveCategoryId}
                          onChange={(e) =>
                            setSelectedCategories((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Sin categoría</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => startEdit(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Editar</span>
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busyId === item.id}
                          onClick={() => void handleReject(item)}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Rechazar</span>
                        </Button>
                        <Button
                          variant="success"
                          size="sm"
                          loading={busyId === item.id}
                          onClick={() => void handleConfirm(item)}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Confirmar</span>
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        title="Importar correo o extracto PDF"
        description="El parser híbrido (reglas + IA opcional) extraerá monto, moneda, fecha y comercio en estado PENDING."
      >
        <form onSubmit={handleManualIngest} className="space-y-4">
          <Input
            id="ingest-subject"
            label="Asunto del correo"
            placeholder="Ej. Alerta de compra: $42.50 en Uber"
            value={ingestSubject}
            onChange={(e) => setIngestSubject(e.target.value)}
          />
          <Input
            id="ingest-from"
            label="Remitente (opcional)"
            placeholder="alertas@mibanco.com"
            value={ingestFrom}
            onChange={(e) => setIngestFrom(e.target.value)}
          />
          <Textarea
            id="ingest-body"
            label="Texto del correo"
            rows={4}
            placeholder="Pega aquí el contenido del correo bancario..."
            value={ingestBody}
            onChange={(e) => setIngestBody(e.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ingest-pdf"
              className="sb-text-secondary text-xs font-medium"
            >
              Extracto PDF adjunto (opcional)
            </label>
            <input
              id="ingest-pdf"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file && file.size > MAX_PDF_BYTES) {
                  setFeedback({
                    type: "error",
                    text: "El archivo PDF supera el límite máximo de 10 MB.",
                  });
                  e.target.value = "";
                  setIngestFile(null);
                  return;
                }
                setIngestFile(file);
              }}
              className="sb-input rounded-xl border p-2 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setIngestOpen(false)}
              disabled={ingesting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={ingesting}>
              Analizar y enviar a Inbox
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
