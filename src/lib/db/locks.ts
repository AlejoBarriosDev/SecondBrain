import { EmailImportStatus, Prisma } from "@prisma/client";
import { NotFoundError } from "@/lib/api/errors";
import type { PrismaTx } from "./prisma";

export interface LockedFinancialAccount {
  id: string;
  userId: string;
  balance: Prisma.Decimal;
  currency: string;
  isArchived: boolean;
}

export interface LockedEmailImportItem {
  id: string;
  userId: string;
  status: EmailImportStatus;
}

/**
 * Deadlock-free PostgreSQL row lock on financial_accounts.
 * Always deduplicates and sorts accountIds ascending before acquiring FOR UPDATE locks.
 */
export async function lockFinancialAccounts(
  tx: PrismaTx,
  userId: string,
  accountIds: string[],
): Promise<Map<string, LockedFinancialAccount>> {
  const sortedIds = [...new Set(accountIds)].sort();
  const result = new Map<string, LockedFinancialAccount>();

  if (sortedIds.length === 0) {
    return result;
  }

  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      userId: string;
      balance: Prisma.Decimal | string;
      currency: string;
      isArchived: boolean;
    }>
  >`
    SELECT id, "userId", balance, currency, "isArchived"
    FROM "financial_accounts"
    WHERE id = ANY(${sortedIds}::text[])
      AND "userId" = ${userId}
    ORDER BY id ASC
    FOR UPDATE
  `;

  if (rows.length !== sortedIds.length) {
    throw new NotFoundError("One or more financial accounts were not found");
  }

  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      userId: row.userId,
      balance: new Prisma.Decimal(row.balance),
      currency: row.currency,
      isArchived: row.isArchived,
    });
  }

  return result;
}

/**
 * Row-level FOR UPDATE lock on an EmailImportItem for atomic confirmation/rejection.
 */
export async function lockEmailImportItem(
  tx: PrismaTx,
  userId: string,
  itemId: string,
): Promise<LockedEmailImportItem> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      userId: string;
      status: EmailImportStatus;
    }>
  >`
    SELECT id, "userId", status
    FROM "email_import_items"
    WHERE id = ${itemId}
      AND "userId" = ${userId}
    FOR UPDATE
  `;

  const row = rows[0];
  if (!row) {
    throw new NotFoundError("Email import item not found");
  }

  return row;
}
