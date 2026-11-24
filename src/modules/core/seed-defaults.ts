import { TransactionType } from "@prisma/client";
import type { PrismaDb } from "@/lib/db/prisma";

interface StarterCategory {
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
  sortOrder: number;
}

export const STARTER_CATEGORIES: readonly StarterCategory[] = [
  // EXPENSE
  { name: "Food & Dining", type: TransactionType.EXPENSE, icon: "utensils", color: "#f97316", sortOrder: 1 },
  { name: "Groceries", type: TransactionType.EXPENSE, icon: "shopping-cart", color: "#22c55e", sortOrder: 2 },
  { name: "Transport", type: TransactionType.EXPENSE, icon: "car", color: "#3b82f6", sortOrder: 3 },
  { name: "Housing & Rent", type: TransactionType.EXPENSE, icon: "home", color: "#8b5cf6", sortOrder: 4 },
  { name: "Utilities", type: TransactionType.EXPENSE, icon: "zap", color: "#eab308", sortOrder: 5 },
  { name: "Subscriptions", type: TransactionType.EXPENSE, icon: "repeat", color: "#ec4899", sortOrder: 6 },
  { name: "Health", type: TransactionType.EXPENSE, icon: "heart-pulse", color: "#ef4444", sortOrder: 7 },
  { name: "Entertainment", type: TransactionType.EXPENSE, icon: "film", color: "#a855f7", sortOrder: 8 },
  { name: "Shopping", type: TransactionType.EXPENSE, icon: "shopping-bag", color: "#14b8a6", sortOrder: 9 },
  { name: "Other Expense", type: TransactionType.EXPENSE, icon: "ellipsis", color: "#64748b", sortOrder: 10 },
  // INCOME
  { name: "Salary", type: TransactionType.INCOME, icon: "briefcase", color: "#10b981", sortOrder: 1 },
  { name: "Freelance", type: TransactionType.INCOME, icon: "laptop", color: "#06b6d4", sortOrder: 2 },
  { name: "Investments", type: TransactionType.INCOME, icon: "trending-up", color: "#6366f1", sortOrder: 3 },
  { name: "Refunds", type: TransactionType.INCOME, icon: "rotate-ccw", color: "#84cc16", sortOrder: 4 },
  { name: "Other Income", type: TransactionType.INCOME, icon: "plus-circle", color: "#64748b", sortOrder: 5 },
  // TRANSFER
  { name: "Account Transfer", type: TransactionType.TRANSFER, icon: "arrow-left-right", color: "#0ea5e9", sortOrder: 1 },
  { name: "Credit Card Payment", type: TransactionType.TRANSFER, icon: "credit-card", color: "#f59e0b", sortOrder: 2 },
];

/**
 * Idempotently seeds default UserSettings, ModuleConfig ("finances"), and starter system Categories
 * for a user. Safe to call both on first login (BetterAuth user.create.after) and via prisma/seed.ts.
 */
export async function seedUserDefaults(db: PrismaDb, userId: string): Promise<void> {
  await db.userSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      defaultCurrency: "USD",
      locale: "es-ES",
      timezone: "UTC",
      theme: "DARK",
      fiscalMonthStartDay: 1,
      aiParserEnabled: true,
    },
  });

  await db.moduleConfig.upsert({
    where: {
      userId_moduleKey: {
        userId,
        moduleKey: "finances",
      },
    },
    update: {},
    create: {
      userId,
      moduleKey: "finances",
      enabled: true,
      sortOrder: 0,
      config: {},
    },
  });

  await db.category.createMany({
    skipDuplicates: true,
    data: STARTER_CATEGORIES.map((cat) => ({
      userId,
      name: cat.name,
      type: cat.type,
      icon: cat.icon,
      color: cat.color,
      isSystem: true,
      sortOrder: cat.sortOrder,
    })),
  });
}
