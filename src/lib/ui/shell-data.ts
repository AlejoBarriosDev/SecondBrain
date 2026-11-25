import { EmailImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getUserSettings } from "@/modules/core/settings";

export interface ShellServerContext {
  pendingInboxCount: number;
  defaultCurrency: string;
  theme: "DARK" | "LIGHT";
}

export async function getShellServerContext(
  userId: string,
): Promise<ShellServerContext> {
  const [pendingInboxCount, settings] = await Promise.all([
    prisma.emailImportItem.count({
      where: { userId, status: EmailImportStatus.PENDING },
    }),
    getUserSettings(userId),
  ]);

  return {
    pendingInboxCount,
    defaultCurrency: settings.defaultCurrency,
    theme: settings.theme === "LIGHT" ? "LIGHT" : "DARK",
  };
}
