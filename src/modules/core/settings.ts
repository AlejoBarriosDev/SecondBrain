import { ThemeMode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { recordAuditLog } from "./audit-logs";

export const updateSettingsSchema = z.object({
  defaultCurrency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code (e.g. USD)")
    .optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  theme: z.nativeEnum(ThemeMode).optional(),
  fiscalMonthStartDay: z.number().int().min(1).max(28).optional(),
  aiParserEnabled: z.boolean().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export async function getUserSettings(userId: string) {
  return prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      defaultCurrency: "USD",
      locale: "es-ES",
      timezone: "UTC",
      theme: ThemeMode.DARK,
      fiscalMonthStartDay: 1,
      aiParserEnabled: true,
    },
  });
}

export async function updateUserSettings(
  userId: string,
  input: UpdateSettingsInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = updateSettingsSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const before = await tx.userSettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        defaultCurrency: "USD",
        locale: "es-ES",
        timezone: "UTC",
        theme: ThemeMode.DARK,
        fiscalMonthStartDay: 1,
        aiParserEnabled: true,
      },
    });

    const updated = await tx.userSettings.update({
      where: { userId },
      data,
    });

    await recordAuditLog(tx, {
      userId,
      action: "SETTINGS_UPDATED",
      entityType: "USER_SETTINGS",
      entityId: updated.id,
      before,
      after: updated,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return updated;
  });
}
