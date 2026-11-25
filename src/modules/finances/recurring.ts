import crypto from "node:crypto";
import {
  EntityType,
  Prisma,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
  TransferDirection,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  addDecimals,
  assertDecimal19_4,
  subDecimals,
  toPositiveDecimal,
} from "@/lib/db/decimal";
import { lockFinancialAccounts } from "@/lib/db/locks";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { recordAuditLog } from "@/modules/core/audit-logs";
import { cleanupPolymorphicEntityRefs } from "@/modules/core/entity-cleanup";
import {
  currencySchema,
  isoDateSchema,
  positiveDecimalStringSchema,
  type RequestMeta,
} from "./types";
import {
  computeBalanceDelta,
  serializeRecurringRule,
  type SerializedRecurringRule,
} from "./serializers";

export const createRecurringRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Rule name is required").max(120),
    type: z.nativeEnum(TransactionType),
    amount: positiveDecimalStringSchema,
    currency: currencySchema.optional(),
    accountId: z.string().trim().min(1, "accountId is required"),
    counterpartyAccountId: z.string().trim().min(1).nullable().optional(),
    toAccountId: z.string().trim().min(1).nullable().optional(),
    categoryId: z.string().trim().min(1).nullable().optional(),
    frequency: z.nativeEnum(RecurrenceFrequency),
    interval: z.number().int().min(1).max(365).default(1),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    nextRunAt: isoDateSchema.optional(),
    autoPost: z.boolean().default(false),
    isActive: z.boolean().default(true),
    merchant: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const counterparty = data.counterpartyAccountId ?? data.toAccountId ?? null;
    if (data.type === TransactionType.TRANSFER) {
      if (!counterparty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Transfer recurring rules require counterpartyAccountId",
          path: ["counterpartyAccountId"],
        });
      } else if (counterparty === data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Source and destination accounts must be different",
          path: ["counterpartyAccountId"],
        });
      }
    }
    if (data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endDate cannot be earlier than startDate",
        path: ["endDate"],
      });
    }
  });

export const updateRecurringRuleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.nativeEnum(TransactionType).optional(),
  amount: positiveDecimalStringSchema.optional(),
  currency: currencySchema.optional(),
  accountId: z.string().trim().min(1).optional(),
  counterpartyAccountId: z.string().trim().min(1).nullable().optional(),
  toAccountId: z.string().trim().min(1).nullable().optional(),
  categoryId: z.string().trim().min(1).nullable().optional(),
  frequency: z.nativeEnum(RecurrenceFrequency).optional(),
  interval: z.number().int().min(1).max(365).optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.nullable().optional(),
  nextRunAt: isoDateSchema.optional(),
  autoPost: z.boolean().optional(),
  isActive: z.boolean().optional(),
  merchant: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type CreateRecurringRuleInput = z.input<typeof createRecurringRuleSchema>;
export type UpdateRecurringRuleInput = z.input<typeof updateRecurringRuleSchema>;

function addMonthsClampedUtc(
  date: Date,
  monthsToAdd: number,
  anchorDay?: number | null,
): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const desiredDay =
    anchorDay != null &&
    Number.isInteger(anchorDay) &&
    anchorDay >= 1 &&
    anchorDay <= 31
      ? anchorDay
      : date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();

  const totalMonths = month + monthsToAdd;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(desiredDay, lastDayOfTargetMonth);

  return new Date(
    Date.UTC(targetYear, targetMonth, clampedDay, hours, minutes, seconds, ms),
  );
}

/**
 * Pure deterministic UTC helper to advance a recurring rule's nextRunAt.
 * Handles month-end clamping (e.g., Jan 31 + 1 month -> Feb 28/29 -> Mar 31) and leap-year YEARLY clamping.
 */
export function computeNextRunAt(
  currentDate: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  dayOfMonth?: number | null,
): Date {
  if (!Number.isInteger(interval) || interval < 1) {
    throw new ValidationError("Recurrence interval must be a positive integer");
  }

  const y = currentDate.getUTCFullYear();
  const m = currentDate.getUTCMonth();
  const d = currentDate.getUTCDate();
  const hh = currentDate.getUTCHours();
  const mm = currentDate.getUTCMinutes();
  const ss = currentDate.getUTCSeconds();
  const ms = currentDate.getUTCMilliseconds();

  switch (frequency) {
    case RecurrenceFrequency.DAILY:
      return new Date(Date.UTC(y, m, d + interval, hh, mm, ss, ms));
    case RecurrenceFrequency.WEEKLY:
      return new Date(Date.UTC(y, m, d + interval * 7, hh, mm, ss, ms));
    case RecurrenceFrequency.BIWEEKLY:
      return new Date(Date.UTC(y, m, d + interval * 14, hh, mm, ss, ms));
    case RecurrenceFrequency.MONTHLY:
      return addMonthsClampedUtc(currentDate, interval, dayOfMonth);
    case RecurrenceFrequency.QUARTERLY:
      return addMonthsClampedUtc(currentDate, interval * 3, dayOfMonth);
    case RecurrenceFrequency.YEARLY:
      return addMonthsClampedUtc(currentDate, interval * 12, dayOfMonth);
  }
}

export async function listRecurringRules(
  userId: string,
): Promise<SerializedRecurringRule[]> {
  const rows = await prisma.recurringRule.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }],
  });

  return rows.map(serializeRecurringRule);
}

export async function createRecurringRule(
  userId: string,
  input: CreateRecurringRuleInput,
  requestMeta?: RequestMeta,
): Promise<SerializedRecurringRule> {
  const data = createRecurringRuleSchema.parse(input);
  const amount = toPositiveDecimal(data.amount);
  const counterpartyAccountId =
    data.counterpartyAccountId !== undefined
      ? data.counterpartyAccountId
      : (data.toAccountId ?? null);

  return prisma.$transaction(async (tx) => {
    const account = await tx.financialAccount.findFirst({
      where: { id: data.accountId, userId },
      select: { id: true, currency: true, isArchived: true },
    });

    if (!account) {
      throw new NotFoundError("Financial account not found");
    }

    if (counterpartyAccountId) {
      const counterparty = await tx.financialAccount.findFirst({
        where: { id: counterpartyAccountId, userId },
        select: { id: true, currency: true },
      });
      if (!counterparty) {
        throw new NotFoundError("Counterparty financial account not found");
      }
      if (
        data.type === TransactionType.TRANSFER &&
        account.currency !== counterparty.currency
      ) {
        throw new ValidationError(
          "Cross-currency recurring transfers are not supported",
          {
            counterpartyAccountId: [
              `Destination account currency (${counterparty.currency}) must match source account currency (${account.currency})`,
            ],
          },
        );
      }
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

    const effectiveCurrency = data.currency ?? account.currency;
    if (effectiveCurrency !== account.currency) {
      throw new ValidationError(
        "Recurring rule currency must match account currency",
        {
          currency: [
            `Recurring rule currency (${effectiveCurrency}) must match account currency (${account.currency})`,
          ],
        },
      );
    }

    const created = await tx.recurringRule.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        amount,
        currency: effectiveCurrency,
        accountId: account.id,
        counterpartyAccountId,
        categoryId: data.categoryId ?? null,
        frequency: data.frequency,
        interval: data.interval,
        dayOfMonth: data.dayOfMonth ?? null,
        dayOfWeek: data.dayOfWeek ?? null,
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        nextRunAt: data.nextRunAt ?? data.startDate,
        autoPost: data.autoPost,
        isActive: data.isActive,
        merchant: data.merchant ?? null,
        notes: data.notes ?? null,
      },
    });

    const serialized = serializeRecurringRule(created);

    await recordAuditLog(tx, {
      userId,
      action: "RECURRING_RULE_CREATED",
      entityType: "RECURRING_RULE",
      entityId: created.id,
      after: serialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return serialized;
  });
}

export async function updateRecurringRule(
  userId: string,
  id: string,
  input: UpdateRecurringRuleInput,
  requestMeta?: RequestMeta,
): Promise<SerializedRecurringRule> {
  const data = updateRecurringRuleSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.recurringRule.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    const nextType = data.type ?? existing.type;
    const nextAccountId = data.accountId ?? existing.accountId;
    const rawCounterparty =
      data.counterpartyAccountId !== undefined
        ? data.counterpartyAccountId
        : data.toAccountId;
    const nextCounterpartyId =
      rawCounterparty !== undefined
        ? rawCounterparty
        : existing.counterpartyAccountId;

    if (nextType === TransactionType.TRANSFER) {
      if (!nextCounterpartyId) {
        throw new ValidationError(
          "Transfer recurring rules require counterpartyAccountId",
          { counterpartyAccountId: ["Required for TRANSFER rules"] },
        );
      }
      if (nextCounterpartyId === nextAccountId) {
        throw new ValidationError(
          "Source and destination accounts must be different",
          { counterpartyAccountId: ["Must differ from accountId"] },
        );
      }
    }

    const nextAccount = await tx.financialAccount.findFirst({
      where: { id: nextAccountId, userId },
      select: { id: true, currency: true },
    });
    if (!nextAccount) {
      throw new NotFoundError("Financial account not found");
    }

    if (nextCounterpartyId) {
      const counterparty = await tx.financialAccount.findFirst({
        where: { id: nextCounterpartyId, userId },
        select: { id: true, currency: true },
      });
      if (!counterparty) {
        throw new NotFoundError("Counterparty financial account not found");
      }
      if (
        nextType === TransactionType.TRANSFER &&
        nextAccount.currency !== counterparty.currency
      ) {
        throw new ValidationError(
          "Cross-currency recurring transfers are not supported",
          {
            counterpartyAccountId: [
              `Destination account currency (${counterparty.currency}) must match source account currency (${nextAccount.currency})`,
            ],
          },
        );
      }
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

    const nextCurrency = data.currency ?? existing.currency;
    if (nextCurrency !== nextAccount.currency) {
      throw new ValidationError(
        "Recurring rule currency must match account currency",
        {
          currency: [
            `Recurring rule currency (${nextCurrency}) must match account currency (${nextAccount.currency})`,
          ],
        },
      );
    }

    const nextStartDate = data.startDate ?? existing.startDate;
    const nextEndDate =
      data.endDate !== undefined ? data.endDate : existing.endDate;
    if (nextEndDate && nextEndDate < nextStartDate) {
      throw new ValidationError("endDate cannot be earlier than startDate", {
        endDate: ["endDate cannot be earlier than startDate"],
      });
    }

    const updated = await tx.recurringRule.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.amount !== undefined
          ? { amount: toPositiveDecimal(data.amount) }
          : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
        ...(rawCounterparty !== undefined
          ? { counterpartyAccountId: rawCounterparty }
          : {}),
        ...(data.categoryId !== undefined
          ? { categoryId: data.categoryId }
          : {}),
        ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
        ...(data.interval !== undefined ? { interval: data.interval } : {}),
        ...(data.dayOfMonth !== undefined
          ? { dayOfMonth: data.dayOfMonth }
          : {}),
        ...(data.dayOfWeek !== undefined ? { dayOfWeek: data.dayOfWeek } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
        ...(data.nextRunAt !== undefined ? { nextRunAt: data.nextRunAt } : {}),
        ...(data.autoPost !== undefined ? { autoPost: data.autoPost } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.merchant !== undefined ? { merchant: data.merchant } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });

    const afterSerialized = serializeRecurringRule(updated);

    await recordAuditLog(tx, {
      userId,
      action: "RECURRING_RULE_UPDATED",
      entityType: "RECURRING_RULE",
      entityId: updated.id,
      before: serializeRecurringRule(existing),
      after: afterSerialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return afterSerialized;
  });
}

export async function deleteRecurringRule(
  userId: string,
  id: string,
  requestMeta?: RequestMeta,
): Promise<{ id: string; deleted: true }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.recurringRule.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    await cleanupPolymorphicEntityRefs(
      tx,
      userId,
      EntityType.RECURRING_RULE,
      existing.id,
    );

    await tx.recurringRule.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "RECURRING_RULE_DELETED",
      entityType: "RECURRING_RULE",
      entityId: existing.id,
      before: serializeRecurringRule(existing),
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}

interface LockedRecurringRuleRow {
  id: string;
  userId: string;
  name: string;
  type: TransactionType;
  amount: Prisma.Decimal | string;
  currency: string;
  accountId: string;
  counterpartyAccountId: string | null;
  categoryId: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  dayOfMonth: number | null;
  startDate: Date;
  endDate: Date | null;
  nextRunAt: Date;
  autoPost: boolean;
  isActive: boolean;
  merchant: string | null;
  notes: string | null;
}

export interface RecurringRunItemResult {
  ruleId: string;
  status: "PROCESSED" | "SKIPPED";
  reason?: string;
  transactionIds?: string[];
  nextRunAt?: string;
}

export interface RecurringRunSummary {
  processedCount: number;
  skippedCount: number;
  results: RecurringRunItemResult[];
}

export async function runDueRecurringRules(
  options?: { userId?: string; now?: Date },
  requestMeta?: RequestMeta,
): Promise<RecurringRunSummary> {
  const now = options?.now ?? new Date();

  const candidates = await prisma.recurringRule.findMany({
    where: {
      ...(options?.userId ? { userId: options.userId } : {}),
      isActive: true,
      nextRunAt: { lte: now },
    },
    select: { id: true },
    orderBy: { nextRunAt: "asc" },
  });

  let processedCount = 0;
  let skippedCount = 0;
  const results: RecurringRunItemResult[] = [];

  for (const candidate of candidates) {
    const itemResult = await prisma.$transaction(
      async (tx): Promise<RecurringRunItemResult> => {
        // Lock the recurring rule row FOR UPDATE so concurrent runners cannot double-fire it
        const lockedRows = await tx.$queryRaw<LockedRecurringRuleRow[]>`
          SELECT id, "userId", name, type, amount, currency, "accountId",
                 "counterpartyAccountId", "categoryId", frequency, interval,
                 "dayOfMonth", "startDate", "endDate", "nextRunAt", "autoPost",
                 "isActive", merchant, notes
          FROM "recurring_rules"
          WHERE id = ${candidate.id}
          FOR UPDATE
        `;

        const rule = lockedRows[0];
        if (!rule) {
          return {
            ruleId: candidate.id,
            status: "SKIPPED",
            reason: "Rule no longer exists",
          };
        }

        const ruleNextRunAt = new Date(rule.nextRunAt);
        const ruleEndDate = rule.endDate ? new Date(rule.endDate) : null;

        if (!rule.isActive || ruleNextRunAt > now) {
          return {
            ruleId: rule.id,
            status: "SKIPPED",
            reason: "Rule is no longer due",
          };
        }

        if (ruleEndDate && ruleNextRunAt > ruleEndDate) {
          await tx.recurringRule.update({
            where: { id: rule.id },
            data: { isActive: false },
          });
          return {
            ruleId: rule.id,
            status: "SKIPPED",
            reason: "Rule passed endDate",
          };
        }

        const txStatus = rule.autoPost
          ? TransactionStatus.POSTED
          : TransactionStatus.PENDING;
        const amount = new Prisma.Decimal(rule.amount);
        const createdIds: string[] = [];

        if (rule.type === TransactionType.TRANSFER) {
          if (!rule.counterpartyAccountId) {
            return {
              ruleId: rule.id,
              status: "SKIPPED",
              reason: "Missing counterpartyAccountId",
            };
          }

          const lockedAccounts = await lockFinancialAccounts(tx, rule.userId, [
            rule.accountId,
            rule.counterpartyAccountId,
          ]);
          const fromAccount = lockedAccounts.get(rule.accountId);
          const toAccount = lockedAccounts.get(rule.counterpartyAccountId);

          if (
            !fromAccount ||
            !toAccount ||
            fromAccount.isArchived ||
            toAccount.isArchived
          ) {
            return {
              ruleId: rule.id,
              status: "SKIPPED",
              reason: "One or more accounts are archived or missing",
            };
          }

          if (fromAccount.currency !== toAccount.currency) {
            return {
              ruleId: rule.id,
              status: "SKIPPED",
              reason: "Cross-currency recurring transfers are not supported",
            };
          }

          const transferGroupId = crypto.randomUUID();
          const [outTx, inTx] = await Promise.all([
            tx.transaction.create({
              data: {
                userId: rule.userId,
                accountId: fromAccount.id,
                counterpartyAccountId: toAccount.id,
                categoryId: rule.categoryId,
                type: TransactionType.TRANSFER,
                amount,
                currency: fromAccount.currency,
                occurredAt: ruleNextRunAt,
                description: rule.name,
                merchant: rule.merchant,
                notes: rule.notes,
                status: txStatus,
                transferGroupId,
                transferDirection: TransferDirection.OUT,
                recurringRuleId: rule.id,
              },
            }),
            tx.transaction.create({
              data: {
                userId: rule.userId,
                accountId: toAccount.id,
                counterpartyAccountId: fromAccount.id,
                categoryId: rule.categoryId,
                type: TransactionType.TRANSFER,
                amount,
                currency: toAccount.currency,
                occurredAt: ruleNextRunAt,
                description: rule.name,
                merchant: rule.merchant,
                notes: rule.notes,
                status: txStatus,
                transferGroupId,
                transferDirection: TransferDirection.IN,
                recurringRuleId: rule.id,
              },
            }),
          ]);

          createdIds.push(outTx.id, inTx.id);

          if (rule.autoPost) {
            const nextFromBalance = assertDecimal19_4(
              subDecimals(fromAccount.balance, amount),
              "amount",
              "Resulting source account balance exceeds Decimal(19,4) bounds",
            );
            const nextToBalance = assertDecimal19_4(
              addDecimals(toAccount.balance, amount),
              "amount",
              "Resulting destination account balance exceeds Decimal(19,4) bounds",
            );
            await tx.financialAccount.update({
              where: { id: fromAccount.id },
              data: { balance: nextFromBalance },
            });
            await tx.financialAccount.update({
              where: { id: toAccount.id },
              data: { balance: nextToBalance },
            });
          }
        } else {
          const lockedAccounts = await lockFinancialAccounts(tx, rule.userId, [
            rule.accountId,
          ]);
          const account = lockedAccounts.get(rule.accountId);

          if (!account || account.isArchived) {
            return {
              ruleId: rule.id,
              status: "SKIPPED",
              reason: "Account is archived or missing",
            };
          }

          const created = await tx.transaction.create({
            data: {
              userId: rule.userId,
              accountId: account.id,
              categoryId: rule.categoryId,
              type: rule.type,
              amount,
              currency: rule.currency,
              occurredAt: ruleNextRunAt,
              description: rule.name,
              merchant: rule.merchant,
              notes: rule.notes,
              status: txStatus,
              recurringRuleId: rule.id,
            },
          });

          createdIds.push(created.id);

          const delta = computeBalanceDelta(rule.type, txStatus, amount);
          if (!delta.isZero()) {
            const nextBalance = assertDecimal19_4(
              addDecimals(account.balance, delta),
              "amount",
              "Resulting account balance exceeds Decimal(19,4) bounds",
            );
            await tx.financialAccount.update({
              where: { id: account.id },
              data: { balance: nextBalance },
            });
          }
        }

        const anchorDay =
          rule.dayOfMonth ?? new Date(rule.startDate).getUTCDate();
        const newNextRunAt = computeNextRunAt(
          ruleNextRunAt,
          rule.frequency,
          rule.interval,
          anchorDay,
        );
        const stillActive = !(ruleEndDate && newNextRunAt > ruleEndDate);

        await tx.recurringRule.update({
          where: { id: rule.id },
          data: {
            lastRunAt: ruleNextRunAt,
            nextRunAt: newNextRunAt,
            isActive: stillActive,
          },
        });

        await recordAuditLog(tx, {
          userId: rule.userId,
          action: "RECURRING_RULE_EXECUTED",
          entityType: "RECURRING_RULE",
          entityId: rule.id,
          after: {
            ruleId: rule.id,
            executedFor: ruleNextRunAt.toISOString(),
            nextRunAt: newNextRunAt.toISOString(),
            transactionIds: createdIds,
            autoPost: rule.autoPost,
          },
          ipAddress: requestMeta?.ipAddress,
          userAgent: requestMeta?.userAgent,
        });

        return {
          ruleId: rule.id,
          status: "PROCESSED",
          transactionIds: createdIds,
          nextRunAt: newNextRunAt.toISOString(),
        };
      },
    );

    if (itemResult.status === "PROCESSED") {
      processedCount += 1;
    } else {
      skippedCount += 1;
    }
    results.push(itemResult);
  }

  return {
    processedCount,
    skippedCount,
    results,
  };
}
