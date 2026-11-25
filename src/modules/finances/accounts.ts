import { FinancialAccountType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toDecimal, toNonNegativeDecimal } from "@/lib/db/decimal";
import { NotFoundError } from "@/lib/api/errors";
import { recordAuditLog } from "@/modules/core/audit-logs";
import {
  currencySchema,
  hexColorSchema,
  nonNegativeDecimalStringSchema,
  type RequestMeta,
  signedDecimalStringSchema,
} from "./types";
import {
  serializeAccount,
  type SerializedFinancialAccount,
} from "./serializers";

const dayOfMonthSchema = z.number().int().min(1).max(31);

export const listAccountsQuerySchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
});

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required").max(100),
  type: z.nativeEnum(FinancialAccountType),
  currency: currencySchema.default("USD"),
  balance: signedDecimalStringSchema.default("0.0000"),
  creditLimit: nonNegativeDecimalStringSchema.nullable().optional(),
  statementClosingDay: dayOfMonthSchema.nullable().optional(),
  paymentDueDay: dayOfMonthSchema.nullable().optional(),
  closingDay: dayOfMonthSchema.nullable().optional(),
  dueDay: dayOfMonthSchema.nullable().optional(),
  institution: z.string().trim().max(100).nullable().optional(),
  lastFour: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "lastFour must be 4 digits")
    .nullable()
    .optional(),
  color: hexColorSchema.nullable().optional(),
  icon: z.string().trim().max(50).nullable().optional(),
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: z.nativeEnum(FinancialAccountType).optional(),
    currency: currencySchema.optional(),
    creditLimit: nonNegativeDecimalStringSchema.nullable().optional(),
    statementClosingDay: dayOfMonthSchema.nullable().optional(),
    paymentDueDay: dayOfMonthSchema.nullable().optional(),
    closingDay: dayOfMonthSchema.nullable().optional(),
    dueDay: dayOfMonthSchema.nullable().optional(),
    institution: z.string().trim().max(100).nullable().optional(),
    lastFour: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "lastFour must be 4 digits")
      .nullable()
      .optional(),
    color: hexColorSchema.nullable().optional(),
    icon: z.string().trim().max(50).nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .strict();

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export async function listAccounts(
  userId: string,
  options?: { includeArchived?: boolean },
): Promise<SerializedFinancialAccount[]> {
  const includeArchived = options?.includeArchived ?? false;
  const rows = await prisma.financialAccount.findMany({
    where: {
      userId,
      ...(includeArchived ? {} : { isArchived: false }),
    },
    orderBy: [{ isArchived: "asc" }, { createdAt: "asc" }],
  });

  return rows.map(serializeAccount);
}

export async function getAccountById(
  userId: string,
  id: string,
): Promise<SerializedFinancialAccount> {
  const account = await prisma.financialAccount.findFirst({
    where: { id, userId },
  });

  if (!account) {
    throw new NotFoundError("Financial account not found");
  }

  return serializeAccount(account);
}

export async function createAccount(
  userId: string,
  input: CreateAccountInput,
  requestMeta?: RequestMeta,
): Promise<SerializedFinancialAccount> {
  const data = createAccountSchema.parse(input);
  const initialBalance = toDecimal(data.balance);
  const creditLimit =
    data.creditLimit != null ? toNonNegativeDecimal(data.creditLimit) : null;
  const statementClosingDay =
    data.statementClosingDay !== undefined
      ? data.statementClosingDay
      : (data.closingDay ?? null);
  const paymentDueDay =
    data.paymentDueDay !== undefined
      ? data.paymentDueDay
      : (data.dueDay ?? null);

  return prisma.$transaction(async (tx) => {
    const created = await tx.financialAccount.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        currency: data.currency,
        balance: initialBalance,
        creditLimit,
        statementClosingDay,
        paymentDueDay,
        institution: data.institution ?? null,
        lastFour: data.lastFour ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
      },
    });

    const serialized = serializeAccount(created);

    await recordAuditLog(tx, {
      userId,
      action: "FINANCIAL_ACCOUNT_CREATED",
      entityType: "FINANCIAL_ACCOUNT",
      entityId: created.id,
      after: serialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return serialized;
  });
}

export async function updateAccount(
  userId: string,
  id: string,
  input: UpdateAccountInput,
  requestMeta?: RequestMeta,
): Promise<SerializedFinancialAccount> {
  const data = updateAccountSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.financialAccount.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Financial account not found");
    }

    const statementClosingDay =
      data.statementClosingDay !== undefined
        ? data.statementClosingDay
        : data.closingDay;
    const paymentDueDay =
      data.paymentDueDay !== undefined ? data.paymentDueDay : data.dueDay;

    const updated = await tx.financialAccount.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.creditLimit !== undefined
          ? {
              creditLimit:
                data.creditLimit != null
                  ? toNonNegativeDecimal(data.creditLimit)
                  : null,
            }
          : {}),
        ...(statementClosingDay !== undefined ? { statementClosingDay } : {}),
        ...(paymentDueDay !== undefined ? { paymentDueDay } : {}),
        ...(data.institution !== undefined
          ? { institution: data.institution }
          : {}),
        ...(data.lastFour !== undefined ? { lastFour: data.lastFour } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.isArchived !== undefined
          ? { isArchived: data.isArchived }
          : {}),
      },
    });

    const beforeSerialized = serializeAccount(existing);
    const afterSerialized = serializeAccount(updated);

    await recordAuditLog(tx, {
      userId,
      action: "FINANCIAL_ACCOUNT_UPDATED",
      entityType: "FINANCIAL_ACCOUNT",
      entityId: updated.id,
      before: beforeSerialized,
      after: afterSerialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return afterSerialized;
  });
}

export async function archiveAccount(
  userId: string,
  id: string,
  requestMeta?: RequestMeta,
): Promise<SerializedFinancialAccount> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.financialAccount.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Financial account not found");
    }

    const updated = await tx.financialAccount.update({
      where: { id: existing.id },
      data: { isArchived: true },
    });

    const beforeSerialized = serializeAccount(existing);
    const afterSerialized = serializeAccount(updated);

    await recordAuditLog(tx, {
      userId,
      action: "FINANCIAL_ACCOUNT_ARCHIVED",
      entityType: "FINANCIAL_ACCOUNT",
      entityId: updated.id,
      before: beforeSerialized,
      after: afterSerialized,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return afterSerialized;
  });
}
