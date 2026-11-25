import {
  EntityType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  formatDecimal,
  subDecimals,
  toPositiveDecimal,
} from "@/lib/db/decimal";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { recordAuditLog } from "@/modules/core/audit-logs";
import { cleanupPolymorphicEntityRefs } from "@/modules/core/entity-cleanup";
import {
  currencySchema,
  positiveDecimalStringSchema,
  type RequestMeta,
} from "./types";
import {
  type BudgetAlertStatus,
  serializeBudget,
  type SerializedBudget,
  type SerializedBudgetWithProgress,
} from "./serializers";

export const listBudgetsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const upsertBudgetSchema = z
  .object({
    categoryId: z.string().trim().min(1, "categoryId is required"),
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    amount: positiveDecimalStringSchema.optional(),
    limitAmount: positiveDecimalStringSchema.optional(),
    currency: currencySchema.default("USD"),
    alertThresholdPct: z.number().int().min(1).max(100).default(80),
    rollover: z.boolean().default(false),
  })
  .refine((data) => data.amount !== undefined || data.limitAmount !== undefined, {
    message: "Either amount or limitAmount is required",
    path: ["amount"],
  });

export type UpsertBudgetInput = z.input<typeof upsertBudgetSchema>;

/**
 * Pure helper computing budget progress & alert status using Prisma.Decimal.
 * - EXCEEDED: spent > limitAmount
 * - WARNING: percentUsed >= alertThresholdPct
 * - OK: otherwise
 */
export function computeBudgetProgress(
  limitAmount: Prisma.Decimal | string,
  spentAmount: Prisma.Decimal | string,
  alertThresholdPct: number,
): {
  spent: string;
  remaining: string;
  percentUsed: number;
  alertStatus: BudgetAlertStatus;
} {
  const limit = toPositiveDecimal(limitAmount);
  const spent =
    spentAmount instanceof Prisma.Decimal
      ? spentAmount
      : new Prisma.Decimal(spentAmount);
  const remaining = subDecimals(limit, spent);
  const percentUsed = Number(spent.div(limit).mul(100).toFixed(2));

  let alertStatus: BudgetAlertStatus = "OK";
  if (spent.gt(limit)) {
    alertStatus = "EXCEEDED";
  } else if (percentUsed >= alertThresholdPct) {
    alertStatus = "WARNING";
  }

  return {
    spent: formatDecimal(spent),
    remaining: formatDecimal(remaining),
    percentUsed,
    alertStatus,
  };
}

export async function upsertBudget(
  userId: string,
  input: UpsertBudgetInput,
  requestMeta?: RequestMeta,
): Promise<SerializedBudget> {
  const data = upsertBudgetSchema.parse(input);
  const rawLimit = data.amount ?? data.limitAmount;
  if (!rawLimit) {
    throw new ValidationError("Budget amount is required");
  }
  const limitDecimal = toPositiveDecimal(rawLimit);

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: data.categoryId, userId },
    });

    if (!category) {
      throw new NotFoundError("Category not found");
    }

    const existing = await tx.budget.findUnique({
      where: {
        userId_categoryId_year_month: {
          userId,
          categoryId: data.categoryId,
          year: data.year,
          month: data.month,
        },
      },
    });

    const saved = await tx.budget.upsert({
      where: {
        userId_categoryId_year_month: {
          userId,
          categoryId: data.categoryId,
          year: data.year,
          month: data.month,
        },
      },
      create: {
        userId,
        categoryId: data.categoryId,
        year: data.year,
        month: data.month,
        amount: limitDecimal,
        currency: data.currency,
        alertThresholdPct: data.alertThresholdPct,
        rollover: data.rollover,
      },
      update: {
        amount: limitDecimal,
        currency: data.currency,
        alertThresholdPct: data.alertThresholdPct,
        rollover: data.rollover,
      },
    });

    const afterSerialized = serializeBudget(saved);

    await recordAuditLog(tx, {
      userId,
      action: existing ? "BUDGET_UPDATED" : "BUDGET_CREATED",
      entityType: "BUDGET",
      entityId: saved.id,
      before: existing ? serializeBudget(existing) : undefined,
      after: afterSerialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return afterSerialized;
  });
}

export async function listBudgets(
  userId: string,
  params: { year: number; month: number },
): Promise<SerializedBudgetWithProgress[]> {
  const { year, month } = listBudgetsQuerySchema.parse(params);

  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  const [budgets, spentByCategory] = await Promise.all([
    prisma.budget.findMany({
      where: { userId, year, month },
      include: {
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
      orderBy: [{ category: { sortOrder: "asc" } }, { category: { name: "asc" } }],
    }),
    prisma.transaction.groupBy({
      by: ["categoryId", "currency"],
      where: {
        userId,
        type: TransactionType.EXPENSE,
        status: TransactionStatus.POSTED,
        categoryId: { not: null },
        occurredAt: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
      _sum: {
        amount: true,
      },
    }),
  ]);

  const spentMap = new Map<string, Prisma.Decimal>();
  for (const row of spentByCategory) {
    if (row.categoryId && row._sum.amount) {
      spentMap.set(`${row.categoryId}:${row.currency}`, row._sum.amount);
    }
  }

  return budgets.map((budget) => {
    const spentDec =
      spentMap.get(`${budget.categoryId}:${budget.currency}`) ??
      new Prisma.Decimal(0);
    const progress = computeBudgetProgress(
      budget.amount,
      spentDec,
      budget.alertThresholdPct,
    );

    return {
      ...serializeBudget(budget),
      category: budget.category,
      ...progress,
    };
  });
}

export async function deleteBudget(
  userId: string,
  id: string,
  requestMeta?: RequestMeta,
): Promise<{ id: string; deleted: true }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.budget.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Budget not found");
    }

    await cleanupPolymorphicEntityRefs(
      tx,
      userId,
      EntityType.BUDGET,
      existing.id,
    );

    await tx.budget.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "BUDGET_DELETED",
      entityType: "BUDGET",
      entityId: existing.id,
      before: serializeBudget(existing),
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}
