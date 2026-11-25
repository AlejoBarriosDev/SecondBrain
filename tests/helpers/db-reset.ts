import { prisma } from "../../src/lib/db/prisma";

const TABLES = [
  "audit_logs",
  "entity_links",
  "attachments",
  "entity_tags",
  "tags",
  "email_import_items",
  "email_sync_states",
  "transactions",
  "recurring_rules",
  "budgets",
  "categories",
  "financial_accounts",
  "module_configs",
  "user_settings",
  "passkey",
  "verification",
  "account",
  "session",
  "user",
];

/**
 * Truncates all application tables in the isolated test database.
 * Refuses to execute unless DATABASE_URL targets a `_test` database.
 */
export async function resetTestDatabase(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("_test")) {
    throw new Error(
      `SAFETY ABORT: resetTestDatabase() refused to run on non-test DATABASE_URL (${dbUrl})`,
    );
  }

  const quotedTables = TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`,
  );
}
