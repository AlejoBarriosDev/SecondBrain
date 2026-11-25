import {
  EntityType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { z } from "zod";
import { prisma, type PrismaTx } from "@/lib/db/prisma";
import { addDecimals, subDecimals, toPositiveDecimal } from "@/lib/db/decimal";
import { lockFinancialAccounts } from "@/lib/db/locks";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { recordAuditLog } from "@/modules/core/audit-logs";
import {
  currencySchema,
  isoDateSchema,
  positiveDecimalStringSchema,
  type RequestMeta,
} from "./types";
import {
  computeBalanceDelta,
  serializeTransaction,
  type SerializedTagSummary,
  type SerializedTransaction,
} from "./serializers";

export const createTransactionSchema = z.object({
  accountId: z.string().trim().min(1, "accountId is required"),
  categoryId: z.string().trim().min(1).nullable().optional(),
  type: z.nativeEnum(TransactionType),
  amount: positiveDecimalStringSchema,
  currency: currencySchema.optional(),
  occurredAt: isoDateSchema.optional(),
  description: z.string().trim().min(1, "Description is required").max(255),
  merchant: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(TransactionStatus).default(TransactionStatus.POSTED),
  tagIds: z.array(z.string().trim().min(1)).max(50).optional(),
});

export const updateTransactionSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).nullable().optional(),
  type: z.nativeEnum(TransactionType).optional(),
  amount: positiveDecimalStringSchema.optional(),
  currency: currencySchema.optional(),
  occurredAt: isoDateSchema.optional(),
  description: z.string().trim().min(1).max(255).optional(),
  merchant: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  tagIds: z.array(z.string().trim().min(1)).max(50).optional(),
});

export const listTransactionsQuerySchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  type: z.nativeEnum(TransactionType).optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  tagId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.input<typeof listTransactionsQuerySchema>;

async function verifyOwnedTagIds(
  tx: PrismaTx,
  userId: string,
  tagIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(tagIds)];
  if (uniqueIds.length === 0) {
    return [];
  }

  const found = await tx.tag.findMany({
    where: { userId, id: { in: uniqueIds } },
    select: { id: true },
  });

  if (found.length !== uniqueIds.length) {
    throw new NotFoundError("One or more tags were not found");
  }

  return uniqueIds;
}

async function batchFetchTransactionTags(
  userId: string,
  transactionIds: string[],
): Promise<Map<string, SerializedTagSummary[]>> {
  const result = new Map<string, SerializedTagSummary[]>();
  if (transactionIds.length === 0) {
    return result;
  }

  const rows = await prisma.entityTag.findMany({
    where: {
      userId,
      entityType: EntityType.TRANSACTION,
      entityId: { in: transactionIds },
    },
    include: {
      tag: {
        select: { id: true, name: true, color: true },
      },
    },
    orderBy: { tag: { name: "asc" } },
  });

  for (const row of rows) {
    const list = result.get(row.entityId) ?? [];
    list.push(row.tag);
    result.set(row.entityId, list);
  }

  return result;
}

export async function buildTransactionWhere(
  userId: string,
  filters: Omit<z.infer<typeof listTransactionsQuerySchema>, "page" | "pageSize">,
): Promise<Prisma.TransactionWhereInput | null> {
  let tagMatchedIds: string[] | undefined;

  if (filters.tagId) {
    const tagged = await prisma.entityTag.findMany({
      where: {
        userId,
        tagId: filters.tagId,
        entityType: EntityType.TRANSACTION,
      },
      select: { entityId: true },
    });
    tagMatchedIds = tagged.map((t) => t.entityId);
    if (tagMatchedIds.length === 0) {
      return null;
    }
  }

  return {
    userId,
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(tagMatchedIds ? { id: { in: tagMatchedIds } } : {}),
    ...(filters.from || filters.to
      ? {
          occurredAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { description: { contains: filters.q, mode: "insensitive" } },
            { merchant: { contains: filters.q, mode: "insensitive" } },
            { notes: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
  requestMeta?: RequestMeta,
): Promise<SerializedTransaction> {
  const data = createTransactionSchema.parse(input);

  if (data.type === TransactionType.TRANSFER) {
    throw new ValidationError(
      "Direct transfer creation is not allowed here; use the transfers endpoint",
      {
        type: ["Use POST /api/finances/transfers for transfers"],
      },
    );
  }

  const amount = toPositiveDecimal(data.amount);
  const occurredAt = data.occurredAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const locked = await lockFinancialAccounts(tx, userId, [data.accountId]);
    const account = locked.get(data.accountId);

    if (!account) {
      throw new NotFoundError("Financial account not found");
    }

    if (account.isArchived) {
      throw new ValidationError(
        "Cannot create a transaction on an archived account",
        {
          accountId: ["Account is archived"],
        },
      );
    }

    if (data.categoryId) {
      const category = await tx.category.findFirst({
        where: { id: data.categoryId, userId },
        select: { id: true },
      });
      if (!category) {
        throw new NotFoundError("Category not found");
      }
    }

    const uniqueTagIds = data.tagIds
      ? await verifyOwnedTagIds(tx, userId, data.tagIds)
      : [];

    const created = await tx.transaction.create({
      data: {
        userId,
        accountId: account.id,
        categoryId: data.categoryId ?? null,
        type: data.type,
        amount,
        currency: data.currency ?? account.currency,
        occurredAt,
        description: data.description,
        merchant: data.merchant ?? null,
        notes: data.notes ?? null,
        status: data.status,
      },
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true },
        },
        category: {
          select: { id: true, name: true, type: true, icon: true, color: true },
        },
      },
    });

    const delta = computeBalanceDelta(
      created.type,
      created.status,
      created.amount,
    );
    if (!delta.isZero()) {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: addDecimals(account.balance, delta) },
      });
    }

    let attachedTags: SerializedTagSummary[] = [];
    if (uniqueTagIds.length > 0) {
      await tx.entityTag.createMany({
        data: uniqueTagIds.map((tagId) => ({
          userId,
          tagId,
          entityType: EntityType.TRANSACTION,
          entityId: created.id,
        })),
        skipDuplicates: true,
      });

      attachedTags = await tx.tag.findMany({
        where: { userId, id: { in: uniqueTagIds } },
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      });
    }

    const serialized = serializeTransaction(created, attachedTags);

    await recordAuditLog(tx, {
      userId,
      action: "TRANSACTION_CREATED",
      entityType: "TRANSACTION",
      entityId: created.id,
      after: serialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return serialized;
  });
}

export async function updateTransaction(
  userId: string,
  id: string,
  input: UpdateTransactionInput,
  requestMeta?: RequestMeta,
): Promise<SerializedTransaction> {
  const data = updateTransactionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    // Strict lock-order DAG: transactions (FOR UPDATE) -> financial_accounts (ORDER BY id ASC FOR UPDATE)
    const lockedTxRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "transactions"
      WHERE id = ${id}
        AND "userId" = ${userId}
      FOR UPDATE
    `;

    if (lockedTxRows.length === 0) {
      throw new NotFoundError("Transaction not found");
    }

    const existing = await tx.transaction.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Transaction not found");
    }

    if (existing.type === TransactionType.TRANSFER) {
      if (
        data.amount !== undefined ||
        data.accountId !== undefined ||
        data.type !== undefined ||
        data.status !== undefined ||
        data.currency !== undefined
      ) {
        throw new ValidationError(
          "Cannot modify financial fields of a transfer transaction; delete and recreate the transfer",
        );
      }
    } else if (data.type === TransactionType.TRANSFER) {
      throw new ValidationError(
        "Cannot convert a standard transaction into a transfer",
        {
          type: ["Use POST /api/finances/transfers for transfers"],
        },
      );
    }

    const nextAccountId = data.accountId ?? existing.accountId;
    const nextType = data.type ?? existing.type;
    const nextStatus = data.status ?? existing.status;
    const nextAmount =
      data.amount !== undefined ? toPositiveDecimal(data.amount) : existing.amount;

    const accountsToLock =
      nextAccountId === existing.accountId
        ? [existing.accountId]
        : [existing.accountId, nextAccountId];

    const locked = await lockFinancialAccounts(tx, userId, accountsToLock);
    const oldAccount = locked.get(existing.accountId);
    const newAccount = locked.get(nextAccountId);

    if (!oldAccount || !newAccount) {
      throw new NotFoundError("Financial account not found");
    }

    if (nextAccountId !== existing.accountId && newAccount.isArchived) {
      throw new ValidationError("Cannot move transaction to an archived account", {
        accountId: ["Account is archived"],
      });
    }

    if (
      nextAccountId !== existing.accountId &&
      newAccount.currency !== existing.currency
    ) {
      throw new ValidationError(
        "Cannot move transaction to an account with a different currency",
        {
          accountId: [
            `Destination account currency (${newAccount.currency}) does not match transaction currency (${existing.currency})`,
          ],
        },
      );
    }

    if (data.categoryId) {
      const category = await tx.category.findFirst({
        where: { id: data.categoryId, userId },
        select: { id: true },
      });
      if (!category) {
        throw new NotFoundError("Category not found");
      }
    }

    const uniqueTagIds =
      data.tagIds !== undefined
        ? await verifyOwnedTagIds(tx, userId, data.tagIds)
        : undefined;

    const oldDelta = computeBalanceDelta(
      existing.type,
      existing.status,
      existing.amount,
      existing.transferDirection,
    );
    const newDelta = computeBalanceDelta(
      nextType,
      nextStatus,
      nextAmount,
      existing.transferDirection,
    );

    if (nextAccountId === existing.accountId) {
      const diff = subDecimals(newDelta, oldDelta);
      if (!diff.isZero()) {
        await tx.financialAccount.update({
          where: { id: oldAccount.id },
          data: { balance: addDecimals(oldAccount.balance, diff) },
        });
      }
    } else {
      if (!oldDelta.isZero()) {
        await tx.financialAccount.update({
          where: { id: oldAccount.id },
          data: { balance: subDecimals(oldAccount.balance, oldDelta) },
        });
      }
      if (!newDelta.isZero()) {
        await tx.financialAccount.update({
          where: { id: newAccount.id },
          data: { balance: addDecimals(newAccount.balance, newDelta) },
        });
      }
    }

    const updated = await tx.transaction.update({
      where: { id: existing.id },
      data: {
        ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
        ...(data.categoryId !== undefined
          ? { categoryId: data.categoryId }
          : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.amount !== undefined ? { amount: nextAmount } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.occurredAt !== undefined
          ? { occurredAt: data.occurredAt }
          : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.merchant !== undefined ? { merchant: data.merchant } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true },
        },
        category: {
          select: { id: true, name: true, type: true, icon: true, color: true },
        },
      },
    });

    if (uniqueTagIds !== undefined) {
      await tx.entityTag.deleteMany({
        where: {
          userId,
          entityType: EntityType.TRANSACTION,
          entityId: existing.id,
        },
      });
      if (uniqueTagIds.length > 0) {
        await tx.entityTag.createMany({
          data: uniqueTagIds.map((tagId) => ({
            userId,
            tagId,
            entityType: EntityType.TRANSACTION,
            entityId: existing.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    const tagRows = await tx.entityTag.findMany({
      where: {
        userId,
        entityType: EntityType.TRANSACTION,
        entityId: existing.id,
      },
      include: { tag: { select: { id: true, name: true, color: true } } },
      orderBy: { tag: { name: "asc" } },
    });

    const afterSerialized = serializeTransaction(
      updated,
      tagRows.map((r) => r.tag),
    );

    await recordAuditLog(tx, {
      userId,
      action: "TRANSACTION_UPDATED",
      entityType: "TRANSACTION",
      entityId: updated.id,
      before: serializeTransaction(existing),
      after: afterSerialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return afterSerialized;
  });
}

export async function voidTransaction(
  userId: string,
  id: string,
  requestMeta?: RequestMeta,
): Promise<SerializedTransaction> {
  return prisma.$transaction(async (tx) => {
    // Strict lock-order DAG: transactions (FOR UPDATE) -> financial_accounts (ORDER BY id ASC FOR UPDATE)
    const lockedTxRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "transactions"
      WHERE id = ${id}
        AND "userId" = ${userId}
      FOR UPDATE
    `;

    if (lockedTxRows.length === 0) {
      throw new NotFoundError("Transaction not found");
    }

    const existing = await tx.transaction.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Transaction not found");
    }

    if (existing.type === TransactionType.TRANSFER) {
      throw new ValidationError(
        "Cannot void a transfer leg directly; delete the transfer via /api/finances/transfers/[transferGroupId]",
      );
    }

    const locked = await lockFinancialAccounts(tx, userId, [existing.accountId]);
    const account = locked.get(existing.accountId);
    if (!account) {
      throw new NotFoundError("Financial account not found");
    }

    const oldDelta = computeBalanceDelta(
      existing.type,
      existing.status,
      existing.amount,
    );
    if (!oldDelta.isZero()) {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: subDecimals(account.balance, oldDelta) },
      });
    }

    const updated = await tx.transaction.update({
      where: { id: existing.id },
      data: { status: TransactionStatus.VOID },
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true },
        },
        category: {
          select: { id: true, name: true, type: true, icon: true, color: true },
        },
      },
    });

    const serialized = serializeTransaction(updated);

    await recordAuditLog(tx, {
      userId,
      action: "TRANSACTION_VOIDED",
      entityType: "TRANSACTION",
      entityId: updated.id,
      before: serializeTransaction(existing),
      after: serialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return serialized;
  });
}

export async function deleteTransaction(
  userId: string,
  id: string,
  requestMeta?: RequestMeta,
): Promise<{ id: string; deleted: true }> {
  return prisma.$transaction(async (tx) => {
    // Strict lock-order DAG: transactions (FOR UPDATE) -> financial_accounts (ORDER BY id ASC FOR UPDATE)
    const lockedTxRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "transactions"
      WHERE id = ${id}
        AND "userId" = ${userId}
      FOR UPDATE
    `;

    if (lockedTxRows.length === 0) {
      throw new NotFoundError("Transaction not found");
    }

    const existing = await tx.transaction.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Transaction not found");
    }

    if (existing.type === TransactionType.TRANSFER) {
      throw new ValidationError(
        "Cannot delete a transfer leg directly; delete the transfer via /api/finances/transfers/[transferGroupId]",
      );
    }

    const locked = await lockFinancialAccounts(tx, userId, [existing.accountId]);
    const account = locked.get(existing.accountId);
    if (!account) {
      throw new NotFoundError("Financial account not found");
    }

    const oldDelta = computeBalanceDelta(
      existing.type,
      existing.status,
      existing.amount,
    );
    if (!oldDelta.isZero()) {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { balance: subDecimals(account.balance, oldDelta) },
      });
    }

    await tx.entityTag.deleteMany({
      where: {
        userId,
        entityType: EntityType.TRANSACTION,
        entityId: existing.id,
      },
    });

    await tx.transaction.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "TRANSACTION_DELETED",
      entityType: "TRANSACTION",
      entityId: existing.id,
      before: serializeTransaction(existing),
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}

export async function getTransactionById(
  userId: string,
  id: string,
): Promise<SerializedTransaction> {
  const tx = await prisma.transaction.findFirst({
    where: { id, userId },
    include: {
      account: {
        select: { id: true, name: true, type: true, currency: true },
      },
      category: {
        select: { id: true, name: true, type: true, icon: true, color: true },
      },
    },
  });

  if (!tx) {
    throw new NotFoundError("Transaction not found");
  }

  const tagMap = await batchFetchTransactionTags(userId, [tx.id]);
  return serializeTransaction(tx, tagMap.get(tx.id) ?? []);
}

export async function listTransactions(
  userId: string,
  query?: ListTransactionsQuery,
): Promise<{
  items: SerializedTransaction[];
  meta: { total: number; page: number; pageSize: number };
}> {
  const parsed = listTransactionsQuerySchema.parse(query ?? {});
  const { page, pageSize, ...filters } = parsed;

  const where = await buildTransactionWhere(userId, filters);
  if (!where) {
    return { items: [], meta: { total: 0, page, pageSize } };
  }

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true },
        },
        category: {
          select: { id: true, name: true, type: true, icon: true, color: true },
        },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const tagMap = await batchFetchTransactionTags(
    userId,
    rows.map((r) => r.id),
  );

  return {
    items: rows.map((r) => serializeTransaction(r, tagMap.get(r.id) ?? [])),
    meta: { total, page, pageSize },
  };
}
