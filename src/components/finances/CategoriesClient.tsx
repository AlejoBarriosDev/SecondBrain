"use client";

import { useState } from "react";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/ui/api-client";
import type { SerializedCategory } from "@/modules/finances/serializers";
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

type CategoryType = "EXPENSE" | "INCOME";

interface CategoryFormState {
  name: string;
  type: CategoryType;
  parentId: string;
  color: string;
  icon: string;
}

const EMPTY_FORM: CategoryFormState = {
  name: "",
  type: "EXPENSE",
  parentId: "",
  color: "#6366f1",
  icon: "",
};

export function CategoriesClient({
  initialCategories,
}: {
  initialCategories: SerializedCategory[];
}) {
  const [categories, setCategories] =
    useState<SerializedCategory[]>(initialCategories);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedCategory | null>(null);
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  const reloadCategories = async () => {
    const res = await apiFetch<SerializedCategory[]>("/api/finances/categories");
    setCategories(res.data);
  };

  const openCreate = (type: CategoryType = "EXPENSE") => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, type });
    setModalOpen(true);
  };

  const openEdit = (cat: SerializedCategory) => {
    setEditing(cat);
    setForm({
      name: cat.name,
      type: cat.type === "INCOME" ? "INCOME" : "EXPENSE",
      parentId: cat.parentId ?? "",
      color: cat.color ?? "#6366f1",
      icon: cat.icon ?? "",
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
        parentId: form.parentId || null,
        color: /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : null,
        icon: form.icon.trim() || null,
      };

      if (editing) {
        await apiFetch(`/api/finances/categories/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", text: "Categoría actualizada." });
      } else {
        await apiFetch("/api/finances/categories", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", text: "Categoría creada." });
      }

      setModalOpen(false);
      await reloadCategories();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error guardando categoría.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: SerializedCategory) => {
    setFeedback(null);
    setBusyId(cat.id);
    try {
      await apiFetch(`/api/finances/categories/${cat.id}`, {
        method: "DELETE",
      });
      await reloadCategories();
      setFeedback({
        type: "info",
        text: `Categoría "${cat.name}" eliminada.`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error al eliminar categoría.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const renderGroup = (title: string, type: CategoryType) => {
    const items = categories.filter((c) => c.type === type);
    const roots = items.filter((c) => !c.parentId);
    const childrenByParent = new Map<string, SerializedCategory[]>();
    for (const item of items) {
      if (item.parentId) {
        const list = childrenByParent.get(item.parentId) ?? [];
        list.push(item);
        childrenByParent.set(item.parentId, list);
      }
    }

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            <Badge variant={type === "INCOME" ? "success" : "default"}>
              {items.length}
            </Badge>
          </div>
          <Button size="sm" variant="secondary" onClick={() => openCreate(type)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Añadir</span>
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="sb-text-secondary py-6 text-center text-xs">
              Sin categorías de {title.toLowerCase()}.
            </p>
          ) : (
            <ul className="space-y-2">
              {roots.map((root) => {
                const kids = childrenByParent.get(root.id) ?? [];
                return (
                  <li key={root.id} className="space-y-1.5">
                    <div className="sb-elevated flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: root.color ?? "#6366f1" }}
                        />
                        <span className="sb-text-primary truncate text-sm font-medium">
                          {root.name}
                        </span>
                        {root.icon ? (
                          <span className="sb-text-muted text-xs">
                            ({root.icon})
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(root)}
                          aria-label={`Editar ${root.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busyId === root.id}
                          onClick={() => handleDelete(root)}
                          aria-label={`Eliminar ${root.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </div>
                    </div>

                    {kids.length > 0 ? (
                      <ul className="ml-6 space-y-1.5 border-l border-[var(--border-subtle)] pl-3">
                        {kids.map((child) => (
                          <li
                            key={child.id}
                            className="sb-elevated flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    child.color ?? root.color ?? "#6366f1",
                                }}
                              />
                              <span className="sb-text-primary truncate text-xs font-medium">
                                {child.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEdit(child)}
                                aria-label={`Editar ${child.name}`}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={busyId === child.id}
                                onClick={() => handleDelete(child)}
                                aria-label={`Eliminar ${child.name}`}
                              >
                                <Trash2 className="h-3 w-3 text-rose-500" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  };

  const parentCandidates = categories.filter(
    (c) => c.type === form.type && c.id !== editing?.id && !c.parentId,
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => openCreate("EXPENSE")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nueva categoría</span>
        </Button>
      </div>

      {feedback ? (
        <FeedbackBanner
          message={feedback}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {categories.length === 0 ? (
        <EmptyState
          icon={<FolderTree className="h-5 w-5" />}
          title="Sin categorías"
          description="Crea categorías jerárquicas para clasificar tus gastos e ingresos."
          action={
            <Button onClick={() => openCreate("EXPENSE")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Crear categoría</span>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {renderGroup("Gastos", "EXPENSE")}
          {renderGroup("Ingresos", "INCOME")}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar categoría" : "Nueva categoría"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="cat-name"
            label="Nombre"
            required
            placeholder="Ej. Supermercado, Salario"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              id="cat-type"
              label="Tipo"
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as CategoryType,
                  parentId: "",
                })
              }
            >
              <option value="EXPENSE">Gasto (EXPENSE)</option>
              <option value="INCOME">Ingreso (INCOME)</option>
            </Select>

            <Select
              id="cat-parent"
              label="Categoría padre (opcional)"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">Ninguna (raíz)</option>
              {parentCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="cat-color"
              label="Color (Hex)"
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
            <Input
              id="cat-icon"
              label="Etiqueta de icono (opcional)"
              placeholder="shopping-cart"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
            />
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
              {editing ? "Guardar" : "Crear categoría"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
