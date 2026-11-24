import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { recordAuditLog } from "./audit-logs";

export const updateModuleConfigSchema = z.object({
  moduleKey: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9_-]+$/,
      "moduleKey must contain only lowercase letters, numbers, underscores, or hyphens",
    ),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateModuleConfigInput = z.infer<typeof updateModuleConfigSchema>;

export async function listModuleConfigs(userId: string) {
  return prisma.moduleConfig.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { moduleKey: "asc" }],
  });
}

export async function upsertModuleConfig(
  userId: string,
  input: UpdateModuleConfigInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = updateModuleConfigSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const before = await tx.moduleConfig.findUnique({
      where: {
        userId_moduleKey: {
          userId,
          moduleKey: data.moduleKey,
        },
      },
    });

    const configJson =
      data.config !== undefined
        ? (JSON.parse(JSON.stringify(data.config)) as Prisma.InputJsonValue)
        : undefined;

    const updated = await tx.moduleConfig.upsert({
      where: {
        userId_moduleKey: {
          userId,
          moduleKey: data.moduleKey,
        },
      },
      update: {
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(configJson !== undefined ? { config: configJson } : {}),
      },
      create: {
        userId,
        moduleKey: data.moduleKey,
        enabled: data.enabled ?? true,
        sortOrder: data.sortOrder ?? 0,
        config: configJson ?? {},
      },
    });

    await recordAuditLog(tx, {
      userId,
      action: "MODULE_CONFIG_UPDATED",
      entityType: "MODULE_CONFIG",
      entityId: updated.id,
      before,
      after: updated,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return updated;
  });
}
