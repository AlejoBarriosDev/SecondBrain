import crypto from "node:crypto";
import {
  EntityType,
  Prisma,
  TransactionStatus,
  TransactionType,
  TransferDirection,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  addDecimals,
  formatDecimal,
  subDecimals,
  toPositiveDecimal,
} from "@/lib/db/decimal";
import { lockFinancialAccounts } from "@/lib/db/locks";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { recordAuditLog } from "@/modules/core/audit-logs";
import {
  exchangeRateStringSchema,
  isoDateSchema,
  positiveDecimalStringSchema,
  type RequestMeta,
} from "./types";
import {
  computeBalanceDelta,
  serializeTransaction,
  type SerializedTransaction,
} from "./serializers";

export const createTransferSchema = z
  .object({
    fromAccountId: z.string().trim().min(1, "fromAccountId is required"),
    toAccountId: z.string().trim().min(1, "toAccountId is required"),
    amount: positiveDecimalStringSchema,
    toAmount: positiveDecimalStringSchema.optional(),
    exchangeRate: exchangeRateStringSchema.optional(),
    occurredAt: isoDateSchema.optional(),
    description: z.string().trim().min(1).max(255).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    categoryId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "Source and destination accounts must be different",
    path: ["toAccountId"],
  });

export const listTransfersQuerySchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateTransferInput = z.input<typeof createTransferSchema>;
export type ListTransfersQuery = z.input<typeof listTransfersQuerySchema>;

export interface TransferResult {
  transferGroupId: string;
  outTransaction: SerializedTransaction;
  inTransaction: SerializedTransaction;
  fromAccountBalance: string;
  toAccountBalance: string;
}

export interface TransferListItem {
  transferGroupId: string;
  occurredAt: string;
  description: string;
  notes: string | null;
  outTransaction: SerializedTransaction;
  inTransaction: SerializedTransaction | null;
}

/**
 * Pure helper to compute destination amount and effective exchange rate for a transfer.
 */
export function computeTransferInAmount(
  outAmount: Prisma.Decimal,
  fromCurrency: string,
  toCurrency: string,
  options?: { toAmount?: string; exchangeRate?: string },
): { inAmount: Prisma.Decimal; exchangeRate: Prisma.Decimal | null } {
  if (options?.toAmount !== undefined) {
    const inAmount = toPositiveDecimal(options.toAmount);
    const rate =
      options.exchangeRate !== undefined
        ? new Prisma.Decimal(options.exchangeRate)
        : fromCurrency !== toCurrency || !inAmount.equals(outAmount)
          ? inAmount
              .div(outAmount)
              .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP)
          : null;
    return { inAmount, exchangeRate: rate };
  }

  if (options?.exchangeRate !== undefined) {
    const rate = new Prisma.Decimal(options.exchangeRate);
    if (!rate.isFinite() || rate.lte(0)) {
      throw new ValidationError("Exchange rate must be greater than zero");
    }
    const inAmount = outAmount
      .mul(rate)
      .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    if (inAmount.lte(0)) {
      throw new ValidationError("Converted transfer amount must be greater than zero");
    }
    return { inAmount, exchangeRate: rate };
  }

  if (fromCurrency === toCurrency) {
    return { inAmount: outAmount, exchangeRate: null };
  }

  throw new ValidationError(
    "Multi-currency transfer requires either toAmount or exchangeRate",
    {
      toAmount: [
        `Cannot convert ${fromCurrency} to ${toCurrency} without toAmount or exchangeRate`,
      ],
    },
  );
}

export async function createTransfer(
  userId: string,
  input: CreateTransferInput,
  requestMeta?: RequestMeta,
): Promise<TransferResult> {
  const data = createTransferSchema.parse(input);
  const outAmount = toPositiveDecimal(data.amount);
  const occurredAt = data.occurredAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    // Lock both accounts in deterministic ascending ID order (prevents deadlocks)
    const locked = await lockFinancialAccounts(tx, userId, [
      data.fromAccountId,
      data.toAccountId,
    ]);

    const fromAccount = locked.get(data.fromAccountId);
    const toAccount = locked.get(data.toAccountId);

    if (!fromAccount || !toAccount) {
      throw new NotFoundError("One or more financial accounts were not found");
    }

    if (fromAccount.isArchived) {
      throw new ValidationError("Cannot transfer from an archived account", {
        fromAccountId: ["Account is archived"],
      });
    }

    if (toAccount.isArchived) {
      throw new ValidationError("Cannot transfer to an archived account", {
        toAccountId: ["Account is archived"],
      });
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

    const { inAmount, exchangeRate } = computeTransferInAmount(
      outAmount,
      fromAccount.currency,
      toAccount.currency,
      {
        toAmount: data.toAmount,
        exchangeRate: data.exchangeRate,
      },
    );

    const transferGroupId = crypto.randomUUID();
    const description = data.description ?? "Account Transfer";

    const [outTx, inTx] = await Promise.all([
      tx.transaction.create({
        data: {
          userId,
          accountId: fromAccount.id,
          counterpartyAccountId: toAccount.id,
          categoryId: data.categoryId ?? null,
          type: TransactionType.TRANSFER,
          amount: outAmount,
          currency: fromAccount.currency,
          occurredAt,
          description,
          notes: data.notes ?? null,
          status: TransactionStatus.POSTED,
          transferGroupId,
          transferDirection: TransferDirection.OUT,
          exchangeRate,
        },
      }),
      tx.transaction.create({
        data: {
          userId,
          accountId: toAccount.id,
          counterpartyAccountId: fromAccount.id,
          categoryId: data.categoryId ?? null,
          type: TransactionType.TRANSFER,
          amount: inAmount,
          currency: toAccount.currency,
          occurredAt,
          description,
          notes: data.notes ?? null,
          status: TransactionStatus.POSTED,
          transferGroupId,
          transferDirection: TransferDirection.IN,
          exchangeRate,
        },
      }),
    ]);

    const nextFromBalance = subDecimals(fromAccount.balance, outAmount);
    const nextToBalance = addDecimals(toAccount.balance, inAmount);

    await tx.financialAccount.update({
      where: { id: fromAccount.id },
      data: { balance: nextFromBalance },
    });

    await tx.financialAccount.update({
      where: { id: toAccount.id },
      data: { balance: nextToBalance },
    });

    const result: TransferResult = {
      transferGroupId,
      outTransaction: serializeTransaction(outTx),
      inTransaction: serializeTransaction(inTx),
      fromAccountBalance: formatDecimal(nextFromBalance),
      toAccountBalance: formatDecimal(nextToBalance),
    };

    await recordAuditLog(tx, {
      userId,
      action: "TRANSFER_CREATED",
      entityType: "TRANSFER",
      entityId: transferGroupId,
      after: result,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return result;
  });
}

export async function deleteTransfer(
  userId: string,
  transferGroupId: string,
  requestMeta?: RequestMeta,
): Promise<{ transferGroupId: string; deleted: true }> {
  return prisma.$transaction(async (tx) => {
    // Strict lock-order DAG: transactions (ORDER BY id ASC FOR UPDATE) -> financial_accounts (ORDER BY id ASC FOR UPDATE)
    const lockedLegRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "transactions"
      WHERE "userId" = ${userId}
        AND "transferGroupId" = ${transferGroupId}
      ORDER BY id ASC
      FOR UPDATE
    `;

    if (lockedLegRows.length === 0) {
      throw new NotFoundError("Transfer not found");
    }

    const legs = await tx.transaction.findMany({
      where: {
        userId,
        transferGroupId,
        type: TransactionType.TRANSFER,
      },
    });

    const outLeg = legs.find(
      (l) => l.transferDirection === TransferDirection.OUT,
    );
    const inLeg = legs.find(
      (l) => l.transferDirection === TransferDirection.IN,
    );

    if (!outLeg || !inLeg) {
      throw new NotFoundError("Transfer not found");
    }

    const locked = await lockFinancialAccounts(tx, userId, [
      outLeg.accountId,
      inLeg.accountId,
    ]);

    // Reverse POSTED deltas per account using fresh locked legs
    const balanceAdjustments = new Map<string, Prisma.Decimal>();
    for (const leg of legs) {
      const delta = computeBalanceDelta(
        leg.type,
        leg.status,
        leg.amount,
        leg.transferDirection,
      );
      if (!delta.isZero()) {
        const currentAdj =
          balanceAdjustments.get(leg.accountId) ?? new Prisma.Decimal(0);
        balanceAdjustments.set(leg.accountId, subDecimals(currentAdj, delta));
      }
    }

    for (const [accountId, adjustment] of balanceAdjustments.entries()) {
      const account = locked.get(accountId);
      if (account && !adjustment.isZero()) {
        await tx.financialAccount.update({
          where: { id: accountId },
          data: { balance: addDecimals(account.balance, adjustment) },
        });
      }
    }

    const legIds = legs.map((l) => l.id);

    await tx.entityTag.deleteMany({
      where: {
        userId,
        entityType: EntityType.TRANSACTION,
        entityId: { in: legIds },
      },
    });

    await tx.transaction.deleteMany({
      where: {
        userId,
        transferGroupId,
      },
    });

    await recordAuditLog(tx, {
      userId,
      action: "TRANSFER_DELETED",
      entityType: "TRANSFER",
      entityId: transferGroupId,
      before: legs.map((l) => serializeTransaction(l)),
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { transferGroupId, deleted: true };
  });
}

export async function listTransfers(
  userId: string,
  query?: ListTransfersQuery,
): Promise<{
  items: TransferListItem[];
  meta: { total: number; page: number; pageSize: number };
}> {
  const { accountId, from, to, page, pageSize } =
    listTransfersQuerySchema.parse(query ?? {});

  const where: Prisma.TransactionWhereInput = {
    userId,
    type: TransactionType.TRANSFER,
    transferDirection: TransferDirection.OUT,
    transferGroupId: { not: null },
    ...(accountId
      ? {
          OR: [{ accountId }, { counterpartyAccountId: accountId }],
        }
      : {}),
    ...(from || to
      ? {
          occurredAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [total, outLegs] = await Promise.all([
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

  const groupIds = outLegs
    .map((l) => l.transferGroupId)
    .filter((id): id is string => Boolean(id));

  const inLegs =
    groupIds.length > 0
      ? await prisma.transaction.findMany({
          where: {
            userId,
            transferGroupId: { in: groupIds },
            transferDirection: TransferDirection.IN,
          },
          include: {
            account: {
              select: { id: true, name: true, type: true, currency: true },
            },
            category: {
              select: {
                id: true,
                name: true,
                type: true,
                icon: true,
                color: true,
              },
            },
          },
        })
      : [];

  const inLegMap = new Map(
    inLegs.map((l) => [l.transferGroupId as string, l]),
  );

  const items: TransferListItem[] = outLegs.map((outLeg) => {
    const groupId = outLeg.transferGroupId as string;
    const inLeg = inLegMap.get(groupId) ?? null;
    return {
      transferGroupId: groupId,
      occurredAt: outLeg.occurredAt.toISOString(),
      description: outLeg.description,
      notes: outLeg.notes,
      outTransaction: serializeTransaction(outLeg),
      inTransaction: inLeg ? serializeTransaction(inLeg) : null,
    };
  });

  return {
    items,
    meta: { total, page, pageSize },
  };
}
