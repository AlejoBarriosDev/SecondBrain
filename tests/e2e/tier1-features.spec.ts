import { test, expect } from "@playwright/test";
import {
  ALLOWED_EMAIL,
  BASE_URL,
  buildMinimalPdfBase64,
  createUnauthenticatedApi,
  expectErrorJson,
  expectOkJson,
  expectPaginatedJson,
  extractRecurringRunCount,
  isValidPngHeader,
  measureEffectiveBackgroundLuminance,
  resetAndCreateOwnerSession,
  type AuditLogDto,
  type BudgetDto,
  type CategoryDto,
  type EmailImportItemDto,
  type EntityLinkDto,
  type FinancialAccountDto,
  type ModuleConfigDto,
  type RecurringRuleDto,
  type RecurringRunResultDto,
  type TagDto,
  type TransactionDto,
  type TransferResultDto,
  type UserSettingsDto,
} from "./fixtures";

test.describe("Tier 1 — Isolated Happy-Path Feature Coverage", () => {
  test("INFRA-08: GET /api/health returns 200 ok with database connected publicly", async () => {
    const anon = await createUnauthenticatedApi();
    try {
      const res = await anon.get("/api/health");
      const data = await expectOkJson<{
        status: string;
        db: string;
        timestamp: string;
      }>(res, 200);

      expect(data.status).toBe("ok");
      expect(data.db).toBe("connected");
      expect(Number.isNaN(Date.parse(data.timestamp))).toBe(false);
    } finally {
      await anon.dispose();
    }
  });

  test("F-AUTH-01/02: Authorized owner session accesses /api/settings while unauthenticated receives 401", async () => {
    const anon = await createUnauthenticatedApi();
    const owner = await resetAndCreateOwnerSession();
    try {
      const unauthRes = await anon.get("/api/settings");
      await expectErrorJson(unauthRes, 401, "UNAUTHORIZED");

      const authRes = await owner.api.get("/api/settings");
      const settings = await expectOkJson<UserSettingsDto>(authRes, 200);

      expect(owner.user.email.toLowerCase()).toBe(ALLOWED_EMAIL.toLowerCase());
      expect(settings.userId).toBe(owner.user.id);
      expect(settings.theme).toBe("DARK");
      expect(settings.defaultCurrency).toBe("USD");
    } finally {
      await anon.dispose();
      await owner.dispose();
    }
  });

  test("F-CORE-01: Shared Core APIs (settings, modules, tags, entity-links, audit-logs) CRUD & persistence", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      // 1. Settings GET & PATCH
      const patchSettingsRes = await owner.api.patch("/api/settings", {
        data: {
          defaultCurrency: "EUR",
          theme: "LIGHT",
          fiscalMonthStartDay: 15,
          aiParserEnabled: false,
        },
      });
      const updatedSettings = await expectOkJson<UserSettingsDto>(
        patchSettingsRes,
        200,
      );
      expect(updatedSettings.defaultCurrency).toBe("EUR");
      expect(updatedSettings.theme).toBe("LIGHT");
      expect(updatedSettings.fiscalMonthStartDay).toBe(15);
      expect(updatedSettings.aiParserEnabled).toBe(false);

      // 2. Modules GET & PATCH
      const listModulesRes = await owner.api.get("/api/modules");
      const modules = await expectOkJson<ModuleConfigDto[]>(
        listModulesRes,
        200,
      );
      expect(modules.some((m) => m.moduleKey === "finances")).toBe(true);

      const patchModuleRes = await owner.api.patch("/api/modules", {
        data: {
          moduleKey: "finances",
          enabled: true,
          sortOrder: 5,
          config: { compactMode: true },
        },
      });
      const updatedModule = await expectOkJson<ModuleConfigDto>(
        patchModuleRes,
        200,
      );
      expect(updatedModule.moduleKey).toBe("finances");
      expect(updatedModule.sortOrder).toBe(5);

      // 3. Tags POST, GET, DELETE
      const createTagRes = await owner.api.post("/api/tags", {
        data: { name: "Recurring-Tag", color: "#10b981" },
      });
      const tag = await expectOkJson<TagDto>(createTagRes, 201);
      expect(tag.name).toBe("Recurring-Tag");
      expect(tag.color).toBe("#10b981");

      const listTagsRes = await owner.api.get("/api/tags");
      const tags = await expectOkJson<TagDto[]>(listTagsRes, 200);
      expect(tags.some((t) => t.id === tag.id)).toBe(true);

      const deleteTagRes = await owner.api.delete(`/api/tags?id=${tag.id}`);
      const deletedTag = await expectOkJson<{ id: string; deleted: boolean }>(
        deleteTagRes,
        200,
      );
      expect(deletedTag.deleted).toBe(true);

      // 4. EntityLinks POST, GET, DELETE
      const createLinkRes = await owner.api.post("/api/entity-links", {
        data: {
          sourceType: "TRANSACTION",
          sourceId: "tx-source-1",
          targetType: "FINANCIAL_ACCOUNT",
          targetId: "acc-target-1",
          relationType: "RELATED_TO",
          metadata: { note: "linked in tier 1" },
        },
      });
      const link = await expectOkJson<EntityLinkDto>(createLinkRes, 201);
      expect(link.relationType).toBe("RELATED_TO");

      const listLinksRes = await owner.api.get(
        "/api/entity-links?entityType=TRANSACTION&entityId=tx-source-1",
      );
      const links = await expectOkJson<EntityLinkDto[]>(listLinksRes, 200);
      expect(links.some((l) => l.id === link.id)).toBe(true);

      const deleteLinkRes = await owner.api.delete(
        `/api/entity-links?id=${link.id}`,
      );
      const deletedLink = await expectOkJson<{ id: string; deleted: boolean }>(
        deleteLinkRes,
        200,
      );
      expect(deletedLink.deleted).toBe(true);

      // 5. AuditLogs GET
      const auditRes = await owner.api.get("/api/audit-logs?page=1&pageSize=25");
      const auditPage = await expectPaginatedJson<AuditLogDto>(auditRes, 200);
      expect(auditPage.meta.total).toBeGreaterThanOrEqual(4);
      const actions = auditPage.data.map((a) => a.action);
      expect(actions).toContain("SETTINGS_UPDATED");
      expect(actions).toContain("MODULE_CONFIG_UPDATED");
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-01: Financial Accounts CRUD (BANK, CASH, CREDIT_CARD, update & archive)", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const bankRes = await owner.api.post("/api/finances/accounts", {
        data: {
          name: "Main Checking",
          type: "BANK",
          currency: "USD",
          balance: "2500.5000",
          institution: "Acme Bank",
          lastFour: "4321",
        },
      });
      const bank = await expectOkJson<FinancialAccountDto>(bankRes, 201);
      expect(bank.type).toBe("BANK");
      expect(bank.balance).toBe("2500.5000");

      const cashRes = await owner.api.post("/api/finances/accounts", {
        data: {
          name: "Wallet Cash",
          type: "CASH",
          currency: "USD",
          balance: "150.0000",
        },
      });
      const cash = await expectOkJson<FinancialAccountDto>(cashRes, 201);
      expect(cash.type).toBe("CASH");
      expect(cash.balance).toBe("150.0000");

      const cardRes = await owner.api.post("/api/finances/accounts", {
        data: {
          name: "Platinum Visa",
          type: "CREDIT_CARD",
          currency: "USD",
          balance: "-400.2500",
          creditLimit: "5000.0000",
          statementClosingDay: 20,
          paymentDueDay: 5,
          lastFour: "9876",
        },
      });
      const card = await expectOkJson<FinancialAccountDto>(cardRes, 201);
      expect(card.type).toBe("CREDIT_CARD");
      expect(card.balance).toBe("-400.2500");
      expect(card.creditLimit).toBe("5000.0000");
      expect(card.statementClosingDay).toBe(20);
      expect(card.paymentDueDay).toBe(5);

      // Update account name & institution
      const patchRes = await owner.api.patch(`/api/finances/accounts/${bank.id}`, {
        data: { name: "Primary Checking", institution: "Global Bank" },
      });
      const patched = await expectOkJson<FinancialAccountDto>(patchRes, 200);
      expect(patched.name).toBe("Primary Checking");
      expect(patched.institution).toBe("Global Bank");

      // Archive CASH account via DELETE
      const archiveRes = await owner.api.delete(
        `/api/finances/accounts/${cash.id}`,
      );
      const archived = await expectOkJson<FinancialAccountDto>(archiveRes, 200);
      expect(archived.isArchived).toBe(true);

      // Verify GET list includes created active accounts
      const listRes = await owner.api.get("/api/finances/accounts");
      const accounts = await expectOkJson<FinancialAccountDto[]>(listRes, 200);
      expect(accounts.some((a) => a.id === bank.id)).toBe(true);
      expect(accounts.some((a) => a.id === card.id)).toBe(true);
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-04: Categories hierarchy CRUD & Monthly Budgets aggregation", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      // Create parent & child categories
      const parentRes = await owner.api.post("/api/finances/categories", {
        data: { name: "Food & Dining Tier1", type: "EXPENSE", color: "#f97316" },
      });
      const parent = await expectOkJson<CategoryDto>(parentRes, 201);
      expect(parent.type).toBe("EXPENSE");

      const childRes = await owner.api.post("/api/finances/categories", {
        data: {
          name: "Coffee Shops Tier1",
          type: "EXPENSE",
          parentId: parent.id,
        },
      });
      const child = await expectOkJson<CategoryDto>(childRes, 201);
      expect(child.parentId).toBe(parent.id);

      const incomeCatRes = await owner.api.post("/api/finances/categories", {
        data: { name: "Consulting Income Tier1", type: "INCOME" },
      });
      const incomeCat = await expectOkJson<CategoryDto>(incomeCatRes, 201);
      expect(incomeCat.type).toBe("INCOME");

      // Create monthly budget for parent category
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;

      const budgetRes = await owner.api.post("/api/finances/budgets", {
        data: {
          categoryId: parent.id,
          year,
          month,
          amount: "500.0000",
          currency: "USD",
          alertThresholdPct: 80,
        },
      });
      const budget = await expectOkJson<BudgetDto>(budgetRes, 201);
      expect(budget.amount).toBe("500.0000");
      expect(budget.alertThresholdPct).toBe(80);

      // Query monthly budgets
      const getBudgetsRes = await owner.api.get(
        `/api/finances/budgets?year=${year}&month=${month}`,
      );
      const budgets = await expectOkJson<BudgetDto[]>(getBudgetsRes, 200);
      const found = budgets.find((b) => b.id === budget.id);
      expect(found).toBeDefined();
      expect(found?.spent).toBe("0.0000");
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-03: Transactions CRUD, atomic balance updates, pagination & CSV/JSON export", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const accRes = await owner.api.post("/api/finances/accounts", {
        data: {
          name: "Ledger Checking",
          type: "BANK",
          currency: "USD",
          balance: "1000.0000",
        },
      });
      const acc = await expectOkJson<FinancialAccountDto>(accRes, 201);

      // Post INCOME (+500.0000 -> 1500.0000)
      const incRes = await owner.api.post("/api/finances/transactions", {
        data: {
          accountId: acc.id,
          type: "INCOME",
          amount: "500.0000",
          currency: "USD",
          occurredAt: new Date().toISOString(),
          description: "Client Retainer",
          merchant: "Acme Corp",
        },
      });
      const incomeTx = await expectOkJson<TransactionDto>(incRes, 201);
      expect(incomeTx.amount).toBe("500.0000");

      // Post EXPENSE (-125.5000 -> 1374.5000)
      const expRes = await owner.api.post("/api/finances/transactions", {
        data: {
          accountId: acc.id,
          type: "EXPENSE",
          amount: "125.5000",
          currency: "USD",
          occurredAt: new Date().toISOString(),
          description: "Grocery Run",
          merchant: "Fresh Market",
        },
      });
      const expenseTx = await expectOkJson<TransactionDto>(expRes, 201);

      const afterPostAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(afterPostAcc.balance).toBe("1374.5000");

      // Update EXPENSE from 125.5000 to 200.0000 -> balance becomes 1300.0000
      const patchTxRes = await owner.api.patch(
        `/api/finances/transactions/${expenseTx.id}`,
        {
          data: { amount: "200.0000", description: "Updated Grocery Run" },
        },
      );
      const patchedTx = await expectOkJson<TransactionDto>(patchTxRes, 200);
      expect(patchedTx.amount).toBe("200.0000");

      const afterPatchAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(afterPatchAcc.balance).toBe("1300.0000");

      // Pagination check
      const listRes = await owner.api.get(
        `/api/finances/transactions?accountId=${acc.id}&page=1&pageSize=1`,
      );
      const page = await expectPaginatedJson<TransactionDto>(listRes, 200);
      expect(page.meta.total).toBe(2);
      expect(page.data).toHaveLength(1);

      // CSV & JSON export
      const csvRes = await owner.api.get("/api/finances/export?format=csv");
      expect(csvRes.status()).toBe(200);
      expect(csvRes.headers()["content-type"]).toContain("text/csv");
      const csvText = await csvRes.text();
      expect(csvText).toContain("Client Retainer");
      expect(csvText).toContain("500.0000");

      const jsonRes = await owner.api.get("/api/finances/export?format=json");
      expect(jsonRes.status()).toBe(200);
      expect(jsonRes.headers()["content-type"]).toContain("application/json");
      const jsonText = await jsonRes.text();
      expect(jsonText).toContain("Updated Grocery Run");

      // Delete EXPENSE -> balance restored to 1500.0000
      const delRes = await owner.api.delete(
        `/api/finances/transactions/${expenseTx.id}`,
      );
      await expectOkJson(delRes, 200);

      const afterDelAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(afterDelAcc.balance).toBe("1500.0000");
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-02: Concurrency-safe transfer creates paired OUT/IN legs and DELETE reverses both", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const fromAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Checking Source",
            type: "BANK",
            currency: "USD",
            balance: "2000.0000",
          },
        }),
        201,
      );
      const toAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Savings Dest",
            type: "BANK",
            currency: "USD",
            balance: "500.0000",
          },
        }),
        201,
      );

      const transferRes = await owner.api.post("/api/finances/transfers", {
        data: {
          fromAccountId: fromAcc.id,
          toAccountId: toAcc.id,
          amount: "350.7500",
          occurredAt: new Date().toISOString(),
          description: "Monthly Savings Transfer",
        },
      });
      const transfer = await expectOkJson<TransferResultDto>(transferRes, 201);
      expect(typeof transfer.transferGroupId).toBe("string");
      expect(transfer.transferGroupId.length).toBeGreaterThan(0);

      const fromAfter = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${fromAcc.id}`),
        200,
      );
      const toAfter = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${toAcc.id}`),
        200,
      );
      expect(fromAfter.balance).toBe("1649.2500");
      expect(toAfter.balance).toBe("850.7500");

      // Reverse transfer via DELETE
      const reverseRes = await owner.api.delete(
        `/api/finances/transfers/${transfer.transferGroupId}`,
      );
      await expectOkJson(reverseRes, 200);

      const fromRestored = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${fromAcc.id}`),
        200,
      );
      const toRestored = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${toAcc.id}`),
        200,
      );
      expect(fromRestored.balance).toBe("2000.0000");
      expect(toRestored.balance).toBe("500.0000");
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-05: Recurring Rule CRUD & idempotent POST /api/finances/recurring/run", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Sub Account",
            type: "BANK",
            currency: "USD",
            balance: "500.0000",
          },
        }),
        201,
      );

      const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const ruleRes = await owner.api.post("/api/finances/recurring", {
        data: {
          name: "Cloud Hosting",
          type: "EXPENSE",
          amount: "29.9900",
          currency: "USD",
          accountId: acc.id,
          frequency: "MONTHLY",
          interval: 1,
          dayOfMonth: 15,
          startDate: pastIso,
          nextRunAt: pastIso,
          autoPost: true,
        },
      });
      const rule = await expectOkJson<RecurringRuleDto>(ruleRes, 201);
      expect(rule.name).toBe("Cloud Hosting");
      expect(rule.amount).toBe("29.9900");

      // First run executes due rule
      const run1 = await expectOkJson<RecurringRunResultDto>(
        await owner.api.post("/api/finances/recurring/run"),
        200,
      );
      const createdCount1 = extractRecurringRunCount(run1);
      expect(createdCount1).toBeGreaterThanOrEqual(1);

      const accAfterRun1 = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(accAfterRun1.balance).toBe("470.0100");

      // Immediate second run is idempotent
      const run2 = await expectOkJson<RecurringRunResultDto>(
        await owner.api.post("/api/finances/recurring/run"),
        200,
      );
      const createdCount2 = extractRecurringRunCount(run2);
      expect(createdCount2).toBe(0);

      const accAfterRun2 = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(accAfterRun2.balance).toBe("470.0100");
    } finally {
      await owner.dispose();
    }
  });

  test("GMAIL-01..03 / PARSE-01..02 / INBOX-01..03: Hybrid parser ingest, edit, confirm, reject & sync graceful handling", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Inbox Checking",
            type: "BANK",
            currency: "USD",
            balance: "1000.0000",
          },
        }),
        201,
      );

      // 1. Ingest bilingual bank alert email
      const ingestEmailRes = await owner.api.post("/api/inbox/ingest", {
        data: {
          externalMessageId: "msg-tier1-en-001",
          fromAddress: "alerts@bank.test",
          subject: "Purchase alert: USD 45.50 at Whole Foods",
          bodyText:
            "You made a debit card purchase of $45.50 USD at Whole Foods Market on 2026-11-20.",
          receivedAt: new Date().toISOString(),
        },
      });
      const emailItem = await expectOkJson<EmailImportItemDto>(
        ingestEmailRes,
        201,
      );
      expect(emailItem.status).toBe("PENDING");
      expect(emailItem.parsedAmount).toBe("45.5000");

      // 2. Ingest PDF statement attachment
      const pdfBase64 = buildMinimalPdfBase64(
        "Compra aprobada por USD 80.00 en Amazon Web Services",
      );
      const ingestPdfRes = await owner.api.post("/api/inbox/ingest", {
        data: {
          externalMessageId: "msg-tier1-pdf-002",
          fromAddress: "estados@banco.test",
          subject: "Extracto bancario PDF",
          bodyText: "Adjunto su extracto mensual.",
          pdfBase64,
          pdfFileName: "extracto.pdf",
          receivedAt: new Date().toISOString(),
        },
      });
      const pdfItem = await expectOkJson<EmailImportItemDto>(ingestPdfRes, 201);
      expect(pdfItem.status).toBe("PENDING");
      expect(pdfItem.hasPdfAttachment).toBe(true);
      expect(pdfItem.parsedAmount).toBe("80.0000");

      // F-FIN-06: Staging isolation — account balance untouched while PENDING
      const untouchedAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(untouchedAcc.balance).toBe("1000.0000");

      // List PENDING items
      const pendingList = await expectOkJson<EmailImportItemDto[]>(
        await owner.api.get("/api/inbox?status=PENDING"),
        200,
      );
      expect(pendingList.some((i) => i.id === emailItem.id)).toBe(true);
      expect(pendingList.some((i) => i.id === pdfItem.id)).toBe(true);

      // Edit first item before confirm
      const patchRes = await owner.api.patch(`/api/inbox/${emailItem.id}`, {
        data: {
          parsedAmount: "45.5000",
          parsedType: "EXPENSE",
          parsedMerchant: "Whole Foods Market",
          suggestedAccountId: acc.id,
        },
      });
      const patchedItem = await expectOkJson<EmailImportItemDto>(patchRes, 200);
      expect(patchedItem.suggestedAccountId).toBe(acc.id);

      // Confirm first item -> updates balance to 954.5000
      const confirmRes = await owner.api.post(
        `/api/inbox/${emailItem.id}/confirm`,
        {
          data: {
            accountId: acc.id,
            type: "EXPENSE",
            amount: "45.5000",
            description: "Whole Foods Market",
          },
        },
      );
      await expectOkJson(confirmRes, 200);

      const confirmedItem = await expectOkJson<EmailImportItemDto>(
        await owner.api.get(`/api/inbox/${emailItem.id}`),
        200,
      );
      expect(confirmedItem.status).toBe("CONFIRMED");

      const afterConfirmAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(afterConfirmAcc.balance).toBe("954.5000");

      // Reject second item -> zero balance change
      const rejectRes = await owner.api.post(`/api/inbox/${pdfItem.id}/reject`);
      await expectOkJson(rejectRes, 200);

      const rejectedItem = await expectOkJson<EmailImportItemDto>(
        await owner.api.get(`/api/inbox/${pdfItem.id}`),
        200,
      );
      expect(rejectedItem.status).toBe("REJECTED");

      const afterRejectAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(afterRejectAcc.balance).toBe("954.5000");

      // Sync without connected Google OAuth degrades gracefully (no 404/405/500)
      const syncRes = await owner.api.post("/api/inbox/sync");
      expect([200, 201, 400, 401, 403, 412, 422]).toContain(syncRes.status());
      const syncBody = (await syncRes.json()) as { ok?: unknown };
      expect(typeof syncBody.ok).toBe("boolean");
    } finally {
      await owner.dispose();
    }
  });

  test("UI-01..04: Command Center dark theme default & all 10 UI routes render cleanly", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();
    const context = await browser.newContext({ baseURL: BASE_URL });
    try {
      await context.addCookies(owner.cookies);
      const page = await context.newPage();

      // Verify root dashboard loads in dark mode by default
      await page.goto("/");
      await expect(page.locator("main")).toBeVisible();

      const darkLuminance = await measureEffectiveBackgroundLuminance(page);
      expect(darkLuminance).toBeLessThan(0.25);

      const protectedRoutes = [
        "/accounts",
        "/transactions",
        "/transfers",
        "/budgets",
        "/categories",
        "/recurring",
        "/inbox",
        "/settings",
      ];

      for (const route of protectedRoutes) {
        const response = await page.goto(route);
        expect(response?.status(), `Route ${route} failed`).toBe(200);
        await expect(page.locator("main")).toBeVisible();
      }

      // Public /login page
      const loginContext = await browser.newContext({ baseURL: BASE_URL });
      try {
        const loginPage = await loginContext.newPage();
        const loginResp = await loginPage.goto("/login");
        expect(loginResp?.status()).toBe(200);
        await expect(loginPage.getByRole("heading").first()).toBeVisible();
      } finally {
        await loginContext.close();
      }
    } finally {
      await context.close();
      await owner.dispose();
    }
  });

  test("PWA-01..03 / INFRA-06: Manifest, valid PNG icons, Service Worker headers & public /offline route", async () => {
    const anon = await createUnauthenticatedApi();
    try {
      // 1. Web App Manifest
      const manifestRes = await anon.get("/manifest.webmanifest");
      expect(manifestRes.status()).toBe(200);
      const manifest = (await manifestRes.json()) as {
        name?: string;
        start_url?: string;
        display?: string;
        icons?: Array<{ src: string; sizes?: string; type?: string }>;
      };
      expect(typeof manifest.name).toBe("string");
      expect(manifest.start_url).toBe("/");
      expect(manifest.display).toBe("standalone");
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect((manifest.icons ?? []).length).toBeGreaterThanOrEqual(2);

      // 2. PNG Icons magic bytes
      for (const iconPath of [
        "/icons/icon-192.png",
        "/icons/icon-512.png",
      ]) {
        const iconRes = await anon.get(iconPath);
        expect(iconRes.status(), `Icon ${iconPath} status`).toBe(200);
        expect(iconRes.headers()["content-type"]).toContain("image/png");
        const buf = await iconRes.body();
        expect(isValidPngHeader(buf), `Invalid PNG magic on ${iconPath}`).toBe(
          true,
        );
      }

      // 3. Service Worker headers & JS body
      const swRes = await anon.get("/sw.js");
      expect(swRes.status()).toBe(200);
      expect(swRes.headers()["content-type"]).toMatch(/javascript/i);
      expect(swRes.headers()["cache-control"] ?? "").toMatch(
        /no-cache|no-store|max-age=0/i,
      );
      const swText = await swRes.text();
      expect(swText).toContain("/api/");
      expect(swText).toContain("/offline");

      // 4. Public /offline route
      const offlineRes = await anon.get("/offline");
      expect(offlineRes.status()).toBe(200);
      const offlineHtml = await offlineRes.text();
      expect(offlineHtml.length).toBeGreaterThan(100);
    } finally {
      await anon.dispose();
    }
  });
});
