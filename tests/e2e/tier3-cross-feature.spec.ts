import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  expectOkJson,
  expectPaginatedJson,
  measureEffectiveBackgroundLuminance,
  resetAndCreateOwnerSession,
  type AuditLogDto,
  type BudgetDto,
  type CategoryDto,
  type DashboardDto,
  type EmailImportItemDto,
  type EntityLinkDto,
  type FinancialAccountDto,
  type ModuleConfigDto,
  type RecurringRuleDto,
  type TagDto,
  type TransactionDto,
  type UserSettingsDto,
} from "./fixtures";

test.describe("Tier 3 — Cross-Feature Pairwise Combinations", () => {
  test("Inbox Confirm -> Account Balance + Linked Transaction + Budget spent + Dashboard Net Worth + AuditLog", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "CrossFeature Checking",
            type: "BANK",
            currency: "USD",
            balance: "1500.0000",
          },
        }),
        201,
      );
      const cat = await expectOkJson<CategoryDto>(
        await owner.api.post("/api/finances/categories", {
          data: { name: "Groceries CrossFeature", type: "EXPENSE" },
        }),
        201,
      );

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;

      await expectOkJson<BudgetDto>(
        await owner.api.post("/api/finances/budgets", {
          data: {
            categoryId: cat.id,
            year,
            month,
            amount: "400.0000",
            currency: "USD",
            alertThresholdPct: 80,
          },
        }),
        201,
      );

      // Ingest email -> PENDING (zero side effects yet)
      const item = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", {
          data: {
            externalMessageId: "msg-cross-feature-001",
            fromAddress: "alerts@bank.test",
            subject: "Purchase $120.25 at SuperMarket",
            bodyText: "You spent $120.25 USD at SuperMarket Central.",
            receivedAt: now.toISOString(),
          },
        }),
        201,
      );

      // Confirm with account & category
      const confirmRes = await owner.api.post(`/api/inbox/${item.id}/confirm`, {
        data: {
          accountId: acc.id,
          categoryId: cat.id,
          type: "EXPENSE",
          amount: "120.2500",
          occurredAt: now.toISOString(),
          description: "SuperMarket Central",
        },
      });
      await expectOkJson(confirmRes, 200);

      // 1. Account balance updated: 1500.0000 - 120.2500 = 1379.7500
      const updatedAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(updatedAcc.balance).toBe("1379.7500");

      // 2. Linked Transaction created with emailImportItemId
      const txPage = await expectPaginatedJson<TransactionDto>(
        await owner.api.get(`/api/finances/transactions?accountId=${acc.id}`),
        200,
      );
      const linkedTx = txPage.data.find((t) => t.emailImportItemId === item.id);
      expect(linkedTx).toBeDefined();
      expect(linkedTx?.amount).toBe("120.2500");
      expect(linkedTx?.categoryId).toBe(cat.id);

      // 3. Monthly Budget spent incremented to 120.2500
      const budgets = await expectOkJson<BudgetDto[]>(
        await owner.api.get(`/api/finances/budgets?year=${year}&month=${month}`),
        200,
      );
      const budget = budgets.find((b) => b.categoryId === cat.id);
      expect(budget?.spent).toBe("120.2500");

      // 4. Dashboard Net Worth reflects exact 1379.7500
      const dashboard = await expectOkJson<DashboardDto>(
        await owner.api.get("/api/finances/dashboard"),
        200,
      );
      expect(dashboard.netWorth).toBe("1379.7500");

      // 5. AuditLog recorded for inbox confirmation
      const audits = await expectPaginatedJson<AuditLogDto>(
        await owner.api.get("/api/audit-logs?page=1&pageSize=50"),
        200,
      );
      expect(
        audits.data.some(
          (a) =>
            (a.entityId === item.id || a.entityId === linkedTx?.id) &&
            /CONFIRM|TRANSACTION_CREATED/i.test(a.action),
        ),
      ).toBe(true);
    } finally {
      await owner.dispose();
    }
  });

  test("BANK -> CREDIT_CARD Transfer preserves exact Net Worth and is excluded from Budget spent", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const bank = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Operating Bank",
            type: "BANK",
            currency: "USD",
            balance: "3000.0000",
          },
        }),
        201,
      );
      const card = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Sapphire Card",
            type: "CREDIT_CARD",
            currency: "USD",
            balance: "-750.0000",
            creditLimit: "8000.0000",
          },
        }),
        201,
      );
      const cat = await expectOkJson<CategoryDto>(
        await owner.api.post("/api/finances/categories", {
          data: { name: "General Expenses Cross", type: "EXPENSE" },
        }),
        201,
      );

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;

      await expectOkJson<BudgetDto>(
        await owner.api.post("/api/finances/budgets", {
          data: {
            categoryId: cat.id,
            year,
            month,
            amount: "500.0000",
            currency: "USD",
            alertThresholdPct: 80,
          },
        }),
        201,
      );

      // Initial Net Worth: 3000.0000 + (-750.0000) = 2250.0000
      const dashBefore = await expectOkJson<DashboardDto>(
        await owner.api.get("/api/finances/dashboard"),
        200,
      );
      expect(dashBefore.netWorth).toBe("2250.0000");

      // Pay 500.0000 from BANK to CREDIT_CARD
      await expectOkJson(
        await owner.api.post("/api/finances/transfers", {
          data: {
            fromAccountId: bank.id,
            toAccountId: card.id,
            amount: "500.0000",
            occurredAt: now.toISOString(),
            description: "Credit card payment",
          },
        }),
        201,
      );

      const bankAfter = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${bank.id}`),
        200,
      );
      const cardAfter = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${card.id}`),
        200,
      );
      expect(bankAfter.balance).toBe("2500.0000");
      expect(cardAfter.balance).toBe("-250.0000");

      // Net Worth MUST remain exactly 2250.0000
      const dashAfter = await expectOkJson<DashboardDto>(
        await owner.api.get("/api/finances/dashboard"),
        200,
      );
      expect(dashAfter.netWorth).toBe("2250.0000");

      // Transfer MUST NOT inflate budget spent
      const budgets = await expectOkJson<BudgetDto[]>(
        await owner.api.get(`/api/finances/budgets?year=${year}&month=${month}`),
        200,
      );
      const budget = budgets.find((b) => b.categoryId === cat.id);
      expect(budget).toBeDefined();
      expect(budget?.spent).toBe("0.0000");
    } finally {
      await owner.dispose();
    }
  });

  test("Recurring Rule Run -> creates linked Transaction -> reflected in CSV and JSON exports", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Recurring Export Bank",
            type: "BANK",
            currency: "USD",
            balance: "800.0000",
          },
        }),
        201,
      );

      const dueDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const rule = await expectOkJson<RecurringRuleDto>(
        await owner.api.post("/api/finances/recurring", {
          data: {
            name: "Spotify Premium Cross",
            type: "EXPENSE",
            amount: "11.9900",
            currency: "USD",
            accountId: acc.id,
            frequency: "MONTHLY",
            interval: 1,
            dayOfMonth: 10,
            startDate: dueDate,
            nextRunAt: dueDate,
            autoPost: true,
          },
        }),
        201,
      );

      await expectOkJson(
        await owner.api.post("/api/finances/recurring/run"),
        200,
      );

      const txPage = await expectPaginatedJson<TransactionDto>(
        await owner.api.get(`/api/finances/transactions?accountId=${acc.id}`),
        200,
      );
      const generatedTx = txPage.data.find(
        (tx) => tx.recurringRuleId === rule.id,
      );
      expect(generatedTx).toBeDefined();
      expect(generatedTx?.amount).toBe("11.9900");

      const csvRes = await owner.api.get("/api/finances/export?format=csv");
      expect(csvRes.status()).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain("Spotify Premium Cross");
      expect(csvText).toContain("11.9900");

      const jsonRes = await owner.api.get("/api/finances/export?format=json");
      expect(jsonRes.status()).toBe(200);
      const jsonText = await jsonRes.text();
      expect(jsonText).toContain("Spotify Premium Cross");
      expect(jsonText).toContain("11.9900");
    } finally {
      await owner.dispose();
    }
  });

  test("Tags & Polymorphic EntityLink attached to real Transaction and FinancialAccount entities", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Tagged Account",
            type: "BANK",
            currency: "USD",
            balance: "600.0000",
          },
        }),
        201,
      );

      const tx = await expectOkJson<TransactionDto>(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: acc.id,
            type: "EXPENSE",
            amount: "75.0000",
            currency: "USD",
            occurredAt: new Date().toISOString(),
            description: "Tax Deductible Software",
          },
        }),
        201,
      );

      // Create tag & attach to TRANSACTION
      const tag = await expectOkJson<TagDto>(
        await owner.api.post("/api/tags", {
          data: { name: "TaxDeductible", color: "#22c55e" },
        }),
        201,
      );

      const attachRes = await owner.api.post("/api/tags", {
        data: {
          tagId: tag.id,
          entityType: "TRANSACTION",
          entityId: tx.id,
        },
      });
      await expectOkJson(attachRes, 201);

      const txTags = await expectOkJson<TagDto[]>(
        await owner.api.get(
          `/api/tags?entityType=TRANSACTION&entityId=${tx.id}`,
        ),
        200,
      );
      expect(txTags.some((t) => t.id === tag.id)).toBe(true);

      // Create polymorphic EntityLink between TRANSACTION and FINANCIAL_ACCOUNT
      const link = await expectOkJson<EntityLinkDto>(
        await owner.api.post("/api/entity-links", {
          data: {
            sourceType: "TRANSACTION",
            sourceId: tx.id,
            targetType: "FINANCIAL_ACCOUNT",
            targetId: acc.id,
            relationType: "FUNDED_BY",
          },
        }),
        201,
      );
      expect(link.relationType).toBe("FUNDED_BY");

      const txLinks = await expectOkJson<EntityLinkDto[]>(
        await owner.api.get(
          `/api/entity-links?entityType=TRANSACTION&entityId=${tx.id}`,
        ),
        200,
      );
      expect(txLinks.some((l) => l.id === link.id)).toBe(true);
    } finally {
      await owner.dispose();
    }
  });

  test("UI-01: Theme toggle in UI persists to localStorage and /api/settings across page.reload()", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();
    const context = await browser.newContext({ baseURL: BASE_URL });
    try {
      await context.addCookies(owner.cookies);
      const page = await context.newPage();

      await page.goto("/");
      await expect(page.locator("main")).toBeVisible();

      // Default dark background luminance < 0.25
      const darkLuminance = await measureEffectiveBackgroundLuminance(page);
      expect(darkLuminance).toBeLessThan(0.25);

      // Click theme toggle button (accessible bilingual name)
      const toggleBtn = page
        .getByRole("button", { name: /tema|theme|claro|light|oscuro|dark/i })
        .first();
      await expect(toggleBtn).toBeVisible();
      await toggleBtn.click();

      // Wait for light theme to apply & settings PATCH to complete
      await expect
        .poll(() => measureEffectiveBackgroundLuminance(page))
        .toBeGreaterThan(0.65);

      // Verify persisted in localStorage
      const storedTheme = await page.evaluate(() => {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && /theme/i.test(key)) {
            return window.localStorage.getItem(key);
          }
        }
        return null;
      });
      expect(storedTheme?.toUpperCase()).toContain("LIGHT");

      // Verify persisted in GET /api/settings
      await expect
        .poll(async () => {
          const settings = await expectOkJson<UserSettingsDto>(
            await owner.api.get("/api/settings"),
            200,
          );
          return settings.theme;
        })
        .toBe("LIGHT");

      // Reload and confirm light theme remains active (zero-FOUC persistence)
      await page.reload();
      await expect(page.locator("main")).toBeVisible();
      const reloadedLuminance = await measureEffectiveBackgroundLuminance(page);
      expect(reloadedLuminance).toBeGreaterThan(0.65);
    } finally {
      await context.close();
      await owner.dispose();
    }
  });

  test("F-CORE-01: ModuleConfig toggle via PATCH /api/modules persists in GET /api/modules and writes AuditLog", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const patchRes = await owner.api.patch("/api/modules", {
        data: {
          moduleKey: "habits",
          enabled: true,
          sortOrder: 2,
          config: { beta: true },
        },
      });
      const createdModule = await expectOkJson<ModuleConfigDto>(patchRes, 200);
      expect(createdModule.moduleKey).toBe("habits");
      expect(createdModule.enabled).toBe(true);

      // Disable module
      const disableRes = await owner.api.patch("/api/modules", {
        data: {
          moduleKey: "habits",
          enabled: false,
        },
      });
      const disabledModule = await expectOkJson<ModuleConfigDto>(
        disableRes,
        200,
      );
      expect(disabledModule.enabled).toBe(false);

      // Confirm persisted in GET /api/modules
      const modules = await expectOkJson<ModuleConfigDto[]>(
        await owner.api.get("/api/modules"),
        200,
      );
      const found = modules.find((m) => m.moduleKey === "habits");
      expect(found?.enabled).toBe(false);

      // Confirm AuditLog recorded MODULE_CONFIG_UPDATED
      const auditPage = await expectPaginatedJson<AuditLogDto>(
        await owner.api.get("/api/audit-logs?action=MODULE_CONFIG_UPDATED"),
        200,
      );
      expect(auditPage.meta.total).toBeGreaterThanOrEqual(2);
      expect(
        auditPage.data.some((a) => a.entityType === "MODULE_CONFIG"),
      ).toBe(true);
    } finally {
      await owner.dispose();
    }
  });
});
