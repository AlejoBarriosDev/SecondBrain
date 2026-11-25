import { TransactionType } from "@prisma/client";
import { z } from "zod";
import { prisma, type PrismaTx } from "@/lib/db/prisma";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { recordAuditLog } from "@/modules/core/audit-logs";
import { hexColorSchema, type RequestMeta } from "./types";
import { serializeCategory, type SerializedCategory } from "./serializers";

export const listCategoriesQuerySchema = z.object({
  type: z.nativeEnum(TransactionType).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(80),
  type: z.nativeEnum(TransactionType),
  parentId: z.string().trim().min(1).nullable().optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  color: hexColorSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: z.nativeEnum(TransactionType).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  color: hexColorSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

async function assertValidParent(
  tx: PrismaTx,
  userId: string,
  parentId: string,
  expectedType: TransactionType,
  selfId?: string,
): Promise<void> {
  if (selfId && parentId === selfId) {
    throw new ValidationError("Category cannot be its own parent", {
      parentId: ["Category cannot be its own parent"],
    });
  }

  const parent = await tx.category.findFirst({
    where: { id: parentId, userId },
  });

  if (!parent) {
    throw new NotFoundError("Parent category not found");
  }

  if (parent.type !== expectedType) {
    throw new ValidationError(
      "Parent category must have the same transaction type",
      {
        parentId: ["Parent category type mismatch"],
      },
    );
  }

  if (!selfId) {
    return;
  }

  // Walk up the ancestor chain to prevent cycles (A -> B -> C -> A)
  const visited = new Set<string>([selfId]);
  let cursor: string | null = parent.id;
  let depth = 0;

  while (cursor) {
    if (visited.has(cursor)) {
      throw new ValidationError(
        "Circular category hierarchy is not allowed",
        {
          parentId: ["Circular parent reference detected"],
        },
      );
    }
    visited.add(cursor);
    depth += 1;
    if (depth > 50) {
      throw new ValidationError("Category hierarchy exceeds maximum depth");
    }

    const node: { parentId: string | null } | null =
      await tx.category.findFirst({
        where: { id: cursor, userId },
        select: { parentId: true },
      });
    cursor = node?.parentId ?? null;
  }
}

export async function listCategories(
  userId: string,
  filter?: { type?: TransactionType },
): Promise<SerializedCategory[]> {
  const rows = await prisma.category.findMany({
    where: {
      userId,
      ...(filter?.type ? { type: filter.type } : {}),
    },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return rows.map(serializeCategory);
}

export async function getCategoryById(
  userId: string,
  id: string,
): Promise<SerializedCategory> {
  const category = await prisma.category.findFirst({
    where: { id, userId },
  });

  if (!category) {
    throw new NotFoundError("Category not found");
  }

  return serializeCategory(category);
}

export async function createCategory(
  userId: string,
  input: CreateCategoryInput,
  requestMeta?: RequestMeta,
): Promise<SerializedCategory> {
  const data = createCategorySchema.parse(input);

  return prisma.$transaction(async (tx) => {
    if (data.parentId) {
      await assertValidParent(tx, userId, data.parentId, data.type);
    }

    const created = await tx.category.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        parentId: data.parentId ?? null,
        icon: data.icon ?? null,
        color: data.color ?? null,
        sortOrder: data.sortOrder,
      },
    });

    const serialized = serializeCategory(created);

    await recordAuditLog(tx, {
      userId,
      action: "CATEGORY_CREATED",
      entityType: "CATEGORY",
      entityId: created.id,
      after: serialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return serialized;
  });
}

export async function updateCategory(
  userId: string,
  id: string,
  input: UpdateCategoryInput,
  requestMeta?: RequestMeta,
): Promise<SerializedCategory> {
  const data = updateCategorySchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.category.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Category not found");
    }

    const effectiveType = data.type ?? existing.type;
    const effectiveParentId =
      data.parentId !== undefined ? data.parentId : existing.parentId;

    if (data.type !== undefined && data.type !== existing.type) {
      const childCount = await tx.category.count({
        where: { parentId: existing.id, userId },
      });
      if (childCount > 0) {
        throw new ValidationError(
          "Cannot change category type while it has child categories",
          {
            type: ["Reassign or remove child categories before changing type"],
          },
        );
      }
    }

    if (effectiveParentId) {
      await assertValidParent(tx, userId, effectiveParentId, effectiveType, id);
    }

    const updated = await tx.category.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });

    const beforeSerialized = serializeCategory(existing);
    const afterSerialized = serializeCategory(updated);

    await recordAuditLog(tx, {
      userId,
      action: "CATEGORY_UPDATED",
      entityType: "CATEGORY",
      entityId: updated.id,
      before: beforeSerialized,
      after: afterSerialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return afterSerialized;
  });
}

export async function deleteCategory(
  userId: string,
  id: string,
  requestMeta?: RequestMeta,
): Promise<{ id: string; deleted: true }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.category.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Category not found");
    }

    await tx.category.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "CATEGORY_DELETED",
      entityType: "CATEGORY",
      entityId: existing.id,
      before: serializeCategory(existing),
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}
