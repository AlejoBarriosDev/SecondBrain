import {
  type Budget,
  type Category,
  type FinancialAccount,
  FinancialAccountType,
  Prisma,
  type RecurringRule,
  type Tag,
  type Transaction,
  TransactionStatus,
  TransactionType,
  TransferDirection,
} from "@prisma/client";
import { addDecimals, formatDecimal, toDecimal } from "@/lib/db/decimal";

export interface SerializedFinancialAccount {
  id: string;
  userId: string;
  name: string;
  type: FinancialAccountType;
  currency: string;
  balance: string;
  creditLimit: string | null;
  availableCredit: string | null;
  statementClosingDay: number | null;
  paymentDueDay: number | null;
  institution: string | null;
  lastFour: string | null;
  color: string | null;
  icon: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedCategory {
  id: string;
  userId: string;
  name: string;
  type: TransactionType;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedBudget {
  id: string;
  userId: string;
  categoryId: string;
  year: number;
  month: number;
  amount: string;
  limitAmount: string;
  currency: string;
  alertThresholdPct: number;
  rollover: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BudgetAlertStatus = "OK" | "WARNING" | "EXCEEDED";

export interface SerializedBudgetWithProgress extends SerializedBudget {
  category: {
    id: string;
    name: string;
    type: TransactionType;
    icon: string | null;
    color: string | null;
  };
  spent: string;
  remaining: string;
  percentUsed: number;
  alertStatus: BudgetAlertStatus;
}

export interface SerializedTagSummary {
  id: string;
  name: string;
  color: string;
}

export interface SerializedTransaction {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  type: TransactionType;
  amount: string;
  currency: string;
  occurredAt: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  status: TransactionStatus;
  transferGroupId: string | null;
  transferDirection: TransferDirection | null;
  counterpartyAccountId: string | null;
  exchangeRate: string | null;
  recurringRuleId: string | null;
  emailImportItemId: string | null;
  createdAt: string;
  updatedAt: string;
  account?: {
    id: string;
    name: string;
    type: FinancialAccountType;
    currency: string;
  };
  category?: {
    id: string;
    name: string;
    type: TransactionType;
    icon: string | null;
    color: string | null;
  } | null;
  tags?: SerializedTagSummary[];
}

export interface SerializedRecurringRule {
  id: string;
  userId: string;
  name: string;
  type: TransactionType;
  amount: string;
  currency: string;
  accountId: string;
  counterpartyAccountId: string | null;
  categoryId: string | null;
  frequency: RecurringRule["frequency"];
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string;
  endDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  autoPost: boolean;
  isActive: boolean;
  merchant: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Computes available credit for CREDIT_CARD accounts using signed-balance accounting:
 * creditLimit + balance (where balance is typically <= 0 for card debt).
 */
export function computeAvailableCredit(
  type: FinancialAccountType,
  balance: Prisma.Decimal | string,
  creditLimit: Prisma.Decimal | string | null,
): string | null {
  if (type !== FinancialAccountType.CREDIT_CARD || creditLimit == null) {
    return null;
  }
  return formatDecimal(addDecimals(creditLimit, balance));
}

/**
 * Computes the signed balance delta a transaction applies to its account.
 * Only POSTED transactions affect account balances; PENDING and VOID have 0 delta.
 */
export function computeBalanceDelta(
  type: TransactionType,
  status: TransactionStatus,
  amount: Prisma.Decimal | string,
  transferDirection?: TransferDirection | null,
): Prisma.Decimal {
  if (status !== TransactionStatus.POSTED) {
    return new Prisma.Decimal(0);
  }
  const dec = toDecimal(amount);
  switch (type) {
    case TransactionType.INCOME:
      return dec;
    case TransactionType.EXPENSE:
      return dec.negated();
    case TransactionType.TRANSFER:
      if (transferDirection === TransferDirection.IN) {
        return dec;
      }
      if (transferDirection === TransferDirection.OUT) {
        return dec.negated();
      }
      return new Prisma.Decimal(0);
  }
}

export function serializeAccount(
  account: FinancialAccount,
): SerializedFinancialAccount {
  return {
    id: account.id,
    userId: account.userId,
    name: account.name,
    type: account.type,
    currency: account.currency,
    balance: formatDecimal(account.balance),
    creditLimit:
      account.creditLimit != null ? formatDecimal(account.creditLimit) : null,
    availableCredit: computeAvailableCredit(
      account.type,
      account.balance,
      account.creditLimit,
    ),
    statementClosingDay: account.statementClosingDay,
    paymentDueDay: account.paymentDueDay,
    institution: account.institution,
    lastFour: account.lastFour,
    color: account.color,
    icon: account.icon,
    isArchived: account.isArchived,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function serializeCategory(category: Category): SerializedCategory {
  return {
    id: category.id,
    userId: category.userId,
    name: category.name,
    type: category.type,
    parentId: category.parentId,
    icon: category.icon,
    color: category.color,
    isSystem: category.isSystem,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function serializeBudget(budget: Budget): SerializedBudget {
  const formatted = formatDecimal(budget.amount);
  return {
    id: budget.id,
    userId: budget.userId,
    categoryId: budget.categoryId,
    year: budget.year,
    month: budget.month,
    amount: formatted,
    limitAmount: formatted,
    currency: budget.currency,
    alertThresholdPct: budget.alertThresholdPct,
    rollover: budget.rollover,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

type TransactionWithRelations = Transaction & {
  account?: Pick<FinancialAccount, "id" | "name" | "type" | "currency">;
  category?: Pick<Category, "id" | "name" | "type" | "icon" | "color"> | null;
};

export function serializeTransaction(
  tx: TransactionWithRelations,
  tags?: Pick<Tag, "id" | "name" | "color">[],
): SerializedTransaction {
  return {
    id: tx.id,
    userId: tx.userId,
    accountId: tx.accountId,
    categoryId: tx.categoryId,
    type: tx.type,
    amount: formatDecimal(tx.amount),
    currency: tx.currency,
    occurredAt: tx.occurredAt.toISOString(),
    description: tx.description,
    merchant: tx.merchant,
    notes: tx.notes,
    status: tx.status,
    transferGroupId: tx.transferGroupId,
    transferDirection: tx.transferDirection,
    counterpartyAccountId: tx.counterpartyAccountId,
    exchangeRate:
      tx.exchangeRate != null ? formatDecimal(tx.exchangeRate, 8) : null,
    recurringRuleId: tx.recurringRuleId,
    emailImportItemId: tx.emailImportItemId,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
    ...(tx.account ? { account: tx.account } : {}),
    ...(tx.category !== undefined ? { category: tx.category } : {}),
    ...(tags !== undefined
      ? {
          tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
        }
      : {}),
  };
}

export function serializeRecurringRule(
  rule: RecurringRule,
): SerializedRecurringRule {
  return {
    id: rule.id,
    userId: rule.userId,
    name: rule.name,
    type: rule.type,
    amount: formatDecimal(rule.amount),
    currency: rule.currency,
    accountId: rule.accountId,
    counterpartyAccountId: rule.counterpartyAccountId,
    categoryId: rule.categoryId,
    frequency: rule.frequency,
    interval: rule.interval,
    dayOfMonth: rule.dayOfMonth,
    dayOfWeek: rule.dayOfWeek,
    startDate: rule.startDate.toISOString(),
    endDate: rule.endDate ? rule.endDate.toISOString() : null,
    nextRunAt: rule.nextRunAt.toISOString(),
    lastRunAt: rule.lastRunAt ? rule.lastRunAt.toISOString() : null,
    autoPost: rule.autoPost,
    isActive: rule.isActive,
    merchant: rule.merchant,
    notes: rule.notes,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}
