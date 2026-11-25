import { EntityType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { formatDecimal } from "@/lib/db/decimal";
import {
  buildTransactionWhere,
  listTransactionsQuerySchema,
} from "./transactions";
import { serializeTransaction } from "./serializers";

const FORMULA_INJECTION_REGEX = /^[\s]*[=+\-@\t\r]/;

export const exportTransactionsQuerySchema = listTransactionsQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["csv", "json"]).default("csv"),
  });

export type ExportTransactionsQuery = z.input<
  typeof exportTransactionsQuerySchema
>;

/**
 * Escapes a single CSV cell value and neutralizes Excel/Sheets formula injection.
 * Any value starting with =, +, -, @, \t, or \r (ignoring leading spaces) is prefixed with '.
 */
export function escapeCsvCell(value: string | null | undefined): string {
  const raw = value ?? "";
  const safe = FORMULA_INJECTION_REGEX.test(raw) ? `'${raw}` : raw;

  if (
    safe.includes(",") ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }

  return safe;
}

const CSV_HEADERS = [
  "id",
  "occurredAt",
  "type",
  "status",
  "amount",
  "currency",
  "accountName",
  "categoryName",
  "description",
  "merchant",
  "notes",
  "transferGroupId",
  "transferDirection",
  "tags",
] as const;

export async function exportTransactions(
  userId: string,
  query?: ExportTransactionsQuery,
): Promise<{
  contentType: string;
  filename: string;
  body: string;
}> {
  const parsed = exportTransactionsQuerySchema.parse(query ?? {});
  const { format, ...filters } = parsed;

  const where = await buildTransactionWhere(userId, filters);

  const rows = where
    ? await prisma.transaction.findMany({
        where,
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
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      })
    : [];

  const txIds = rows.map((r) => r.id);
  const tagMap = new Map<string, { id: string; name: string; color: string }[]>();

  if (txIds.length > 0) {
    const entityTags = await prisma.entityTag.findMany({
      where: {
        userId,
        entityType: EntityType.TRANSACTION,
        entityId: { in: txIds },
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

  const dateStamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const serialized = rows.map((r) =>
      serializeTransaction(r, tagMap.get(r.id) ?? []),
    );
    return {
      contentType: "application/json; charset=utf-8",
      filename: `transactions-${dateStamp}.json`,
      body: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          count: serialized.length,
          transactions: serialized,
        },
        null,
        2,
      ),
    };
  }

  const lines: string[] = [CSV_HEADERS.join(",")];

  for (const row of rows) {
    const tags = (tagMap.get(row.id) ?? []).map((t) => t.name).join(";");
    const cells = [
      escapeCsvCell(row.id),
      escapeCsvCell(row.occurredAt.toISOString()),
      escapeCsvCell(row.type),
      escapeCsvCell(row.status),
      escapeCsvCell(formatDecimal(row.amount)),
      escapeCsvCell(row.currency),
      escapeCsvCell(row.account.name),
      escapeCsvCell(row.category?.name ?? ""),
      escapeCsvCell(row.description),
      escapeCsvCell(row.merchant ?? ""),
      escapeCsvCell(row.notes ?? ""),
      escapeCsvCell(row.transferGroupId ?? ""),
      escapeCsvCell(row.transferDirection ?? ""),
      escapeCsvCell(tags),
    ];
    lines.push(cells.join(","));
  }

  return {
    contentType: "text/csv; charset=utf-8",
    filename: `transactions-${dateStamp}.csv`,
    body: lines.join("\n"),
  };
}
