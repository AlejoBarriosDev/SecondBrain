import {
  EmailImportStatus,
  EntityType,
  FinancialAccountType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { addDecimals, formatDecimal, subDecimals } from "@/lib/db/decimal";
import { listBudgets } from "./budgets";
import {
  serializeAccount,
  serializeRecurringRule,
  serializeTransaction,
  type SerializedBudgetWithProgress,
  type SerializedFinancialAccount,
  type SerializedRecurringRule,
  type SerializedTagSummary,
  type SerializedTransaction,
} from "./serializers";

export const dashboardQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export interface CurrencyNetWorth {
  currency: string;
  totalBalance: string;
  assets: string;
  liabilities: string;
}

export interface CurrencyCashflow {
  currency: string;
  income: string;
  expense: string;
  net: string;
}

export interface FinanceDashboardData {
  netWorth: string;
  accounts: SerializedFinancialAccount[];
  netWorthByCurrency: CurrencyNetWorth[];
  monthlyCashflow: {
    year: number;
    month: number;
    byCurrency: CurrencyCashflow[];
  };
  budgetsSummary: SerializedBudgetWithProgress[];
  recentTransactions: SerializedTransaction[];
  upcomingRecurring: SerializedRecurringRule[];
  pendingInboxCount: number;
}

export async function getFinanceDashboard(
  userId: string,
  params?: { year?: number; month?: number },
): Promise<FinanceDashboardData> {
  const parsed = dashboardQuerySchema.parse(params ?? {});
  const now = new Date();
  const year = parsed.year ?? now.getUTCFullYear();
  const month = parsed.month ?? now.getUTCMonth() + 1;

  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  const [
    activeAccounts,
    cashflowRows,
    budgetsSummary,
    recentTxRows,
    upcomingRecurringRows,
    pendingInboxCount,
  ] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId, isArchived: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transaction.groupBy({
      by: ["currency", "type"],
      where: {
        userId,
        status: TransactionStatus.POSTED,
        type: { in: [TransactionType.INCOME, TransactionType.EXPENSE] },
        occurredAt: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
      _sum: {
        amount: true,
      },
    }),
    listBudgets(userId, { year, month }),
    prisma.transaction.findMany({
      where: { userId },
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true },
        },
        category: {
          select: { id: true, name: true, type: true, icon: true, color: true },
        },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
    prisma.recurringRule.findMany({
      where: { userId, isActive: true },
      orderBy: { nextRunAt: "asc" },
      take: 10,
    }),
    prisma.emailImportItem.count({
      where: { userId, status: EmailImportStatus.PENDING },
    }),
  ]);

  // Compute Net Worth (overall and by Currency) using Prisma.Decimal
  let totalNetWorth = new Prisma.Decimal(0);
  const netWorthMap = new Map<
    string,
    { total: Prisma.Decimal; assets: Prisma.Decimal; liabilities: Prisma.Decimal }
  >();

  for (const acc of activeAccounts) {
    totalNetWorth = addDecimals(totalNetWorth, acc.balance);
    const entry = netWorthMap.get(acc.currency) ?? {
      total: new Prisma.Decimal(0),
      assets: new Prisma.Decimal(0),
      liabilities: new Prisma.Decimal(0),
    };
    entry.total = addDecimals(entry.total, acc.balance);
    if (acc.type === FinancialAccountType.CREDIT_CARD) {
      entry.liabilities = addDecimals(entry.liabilities, acc.balance);
    } else {
      entry.assets = addDecimals(entry.assets, acc.balance);
    }
    netWorthMap.set(acc.currency, entry);
  }

  const netWorthByCurrency: CurrencyNetWorth[] = [...netWorthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, sums]) => ({
      currency,
      totalBalance: formatDecimal(sums.total),
      assets: formatDecimal(sums.assets),
      liabilities: formatDecimal(sums.liabilities),
    }));

  // Compute Monthly Cashflow by Currency (excluding TRANSFER)
  const cashflowMap = new Map<
    string,
    { income: Prisma.Decimal; expense: Prisma.Decimal }
  >();

  for (const row of cashflowRows) {
    const sum = row._sum.amount ?? new Prisma.Decimal(0);
    const entry = cashflowMap.get(row.currency) ?? {
      income: new Prisma.Decimal(0),
      expense: new Prisma.Decimal(0),
    };
    if (row.type === TransactionType.INCOME) {
      entry.income = addDecimals(entry.income, sum);
    } else if (row.type === TransactionType.EXPENSE) {
      entry.expense = addDecimals(entry.expense, sum);
    }
    cashflowMap.set(row.currency, entry);
  }

  const cashflowByCurrency: CurrencyCashflow[] = [...cashflowMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, sums]) => ({
      currency,
      income: formatDecimal(sums.income),
      expense: formatDecimal(sums.expense),
      net: formatDecimal(subDecimals(sums.income, sums.expense)),
    }));

  // Batch fetch tags for recentTransactions
  const recentTxIds = recentTxRows.map((t) => t.id);
  const tagMap = new Map<string, SerializedTagSummary[]>();
  if (recentTxIds.length > 0) {
    const entityTags = await prisma.entityTag.findMany({
      where: {
        userId,
        entityType: EntityType.TRANSACTION,
        entityId: { in: recentTxIds },
      },
      include: { tag: { select: { id: true, name: true, color: true } } },
      orderBy: { tag: { name: "asc" } },
    });
    for (const et of entityTags) {
      const list = tagMap.get(et.entityId) ?? [];
      list.push(et.tag);
      tagMap.set(et.entityId, list);
    }
  }

  return {
    netWorth: formatDecimal(totalNetWorth),
    accounts: activeAccounts.map(serializeAccount),
    netWorthByCurrency,
    monthlyCashflow: {
      year,
      month,
      byCurrency: cashflowByCurrency,
    },
    budgetsSummary,
    recentTransactions: recentTxRows.map((tx) =>
      serializeTransaction(tx, tagMap.get(tx.id) ?? []),
    ),
    upcomingRecurring: upcomingRecurringRows.map(serializeRecurringRule),
    pendingInboxCount,
  };
}
