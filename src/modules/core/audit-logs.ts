import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, type PrismaDb } from "@/lib/db/prisma";

export interface RecordAuditLogInput {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function toInputJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAuditLog(
  db: PrismaDb,
  input: RecordAuditLogInput,
) {
  return db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: toInputJson(input.before),
      after: toInputJson(input.after),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export const listAuditLogsQuerySchema = z.object({
  entityType: z.string().trim().min(1).max(64).optional(),
  entityId: z.string().trim().min(1).max(128).optional(),
  action: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export async function listAuditLogs(
  userId: string,
  query: Partial<ListAuditLogsQuery> = {},
) {
  const parsed = listAuditLogsQuerySchema.parse(query);
  const where: Prisma.AuditLogWhereInput = {
    userId,
    ...(parsed.entityType ? { entityType: parsed.entityType } : {}),
    ...(parsed.entityId ? { entityId: parsed.entityId } : {}),
    ...(parsed.action ? { action: parsed.action } : {}),
  };

  const skip = (parsed.page - 1) * parsed.pageSize;

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: parsed.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items,
    meta: {
      total,
      page: parsed.page,
      pageSize: parsed.pageSize,
    },
  };
}
