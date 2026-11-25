import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  buildMinimalPdfBase64,
  createForbiddenSession,
  createUnauthenticatedApi,
  expectErrorJson,
  expectOkJson,
  expectPaginatedJson,
  isValidPngHeader,
  measureEffectiveBackgroundLuminance,
  resetAndCreateOwnerSession,
  type AuditLogDto,
  type BudgetDto,
  type CategoryDto,
  type DashboardDto,
  type EmailImportItemDto,
  type FinancialAccountDto,
  type RecurringRuleDto,
  type UserSettingsDto,
} from "./fixtures";

test.describe("Tier 4 — End-to-End Real-World Application Scenarios", () => {
  test("Scenario 1: Full Monthly Personal Finance Lifecycle (Accounts, Categories, Budgets, Ledger, CC Transfer & Bento Dashboard)", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1280, height: 800 },
    });
    try {
      await context.addCookies(owner.cookies);
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;

      // 1. Setup BANK, CASH, and CREDIT_CARD accounts
      const checking = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Main Checking",
            type: "BANK",
            currency: "USD",
            balance: "1250.0000",
          },
        }),
        201,
      );
      const wallet = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Daily Cash",
            type: "CASH",
            currency: "USD",
            balance: "200.0000",
          },
        }),
        201,
      );
      const visa = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Rewards Visa",
            type: "CREDIT_CARD",
            currency: "USD",
            balance: "-300.0000",
            creditLimit: "5000.0000",
            statementClosingDay: 25,
            paymentDueDay: 10,
          },
        }),
        201,
      );

      // 2. Setup Categories & Monthly Budget
      const salaryCat = await expectOkJson<CategoryDto>(
        await owner.api.post("/api/finances/categories", {
          data: { name: "Monthly Salary S1", type: "INCOME" },
        }),
        201,
      );
      const livingCat = await expectOkJson<CategoryDto>(
        await owner.api.post("/api/finances/categories", {
          data: { name: "Living Expenses S1", type: "EXPENSE" },
        }),
        201,
      );

      await expectOkJson<BudgetDto>(
        await owner.api.post("/api/finances/budgets", {
          data: {
            categoryId: livingCat.id,
            year,
            month,
            amount: "1000.0000",
            currency: "USD",
            alertThresholdPct: 80,
          },
        }),
        201,
      );

      // 3. Record Salary Income (+4000.0000 -> checking = 5250.0000)
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: checking.id,
            categoryId: salaryCat.id,
            type: "INCOME",
            amount: "4000.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "November Payroll",
            merchant: "Employer Inc",
          },
        }),
        201,
      );

      // 4. Record Expenses: 650.0000 on checking, 200.0000 on visa, 50.0000 on cash
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: checking.id,
            categoryId: livingCat.id,
            type: "EXPENSE",
            amount: "650.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "Apartment Utilities",
          },
        }),
        201,
      );
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: visa.id,
            categoryId: livingCat.id,
            type: "EXPENSE",
            amount: "200.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "Weekly Groceries",
          },
        }),
        201,
      );
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: wallet.id,
            categoryId: livingCat.id,
            type: "EXPENSE",
            amount: "50.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "Street Market",
          },
        }),
        201,
      );

      // 5. Pay down 400.0000 on Visa from Checking
      // Checking: 1250 + 4000 - 650 - 400 = 4200.0000
      // Cash: 200 - 50 = 150.0000
      // Visa: -300 - 200 + 400 = -100.0000
      // Net Worth: 4200 + 150 - 100 = 4250.0000 (distinct from Salary 4000.0000)
      await expectOkJson(
        await owner.api.post("/api/finances/transfers", {
          data: {
            fromAccountId: checking.id,
            toAccountId: visa.id,
            amount: "400.0000",
            occurredAt: now.toISOString(),
            description: "Visa Card Payment",
          },
        }),
        201,
      );

      const finalChecking = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${checking.id}`),
        200,
      );
      const finalWallet = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${wallet.id}`),
        200,
      );
      const finalVisa = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${visa.id}`),
        200,
      );
      expect(finalChecking.balance).toBe("4200.0000");
      expect(finalWallet.balance).toBe("150.0000");
      expect(finalVisa.balance).toBe("-100.0000");

      const dashboard = await expectOkJson<DashboardDto>(
        await owner.api.get("/api/finances/dashboard"),
        200,
      );
      expect(dashboard.netWorth).toBe("4250.0000");

      const budgets = await expectOkJson<BudgetDto[]>(
        await owner.api.get(`/api/finances/budgets?year=${year}&month=${month}`),
        200,
      );
      const livingBudget = budgets.find((b) => b.categoryId === livingCat.id);
      expect(livingBudget).toBeDefined();
      expect(livingBudget?.spent).toBe("900.0000");

      // 6. Verify Command Center Bento Grid Dashboard renders live data
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator("main")).toBeVisible();
      const bodyText = await page.locator("main").innerText();
      expect(bodyText).toMatch(/4[,.]?250/);
      expect(bodyText).toContain("Main Checking");
    } finally {
      await context.close();
      await owner.dispose();
    }
  });

  test("Scenario 2: Gmail / Hybrid Parser Review Inbox Workflow (EN/ES + PDF, Staging Isolation, Confirm/Reject & /inbox UI)", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1280, height: 800 },
    });
    try {
      await context.addCookies(owner.cookies);

      const bank = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Inbox Primary Bank",
            type: "BANK",
            currency: "USD",
            balance: "2000.0000",
          },
        }),
        201,
      );
      const cat = await expectOkJson<CategoryDto>(
        await owner.api.post("/api/finances/categories", {
          data: { name: "Dining Inbox S2", type: "EXPENSE" },
        }),
        201,
      );

      // Ingest Spanish bank alert email
      const esItem = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", {
          data: {
            externalMessageId: "msg-scenario2-es-001",
            fromAddress: "notificaciones@banco.es",
            subject: "Compra aprobada por USD 64.25 en Cafe Central",
            bodyText:
              "Se realizo una compra con tarjeta por USD 64.25 en Cafe Central.",
            receivedAt: new Date().toISOString(),
          },
        }),
        201,
      );

      // Ingest English PDF statement attachment
      const pdfItem = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", {
          data: {
            externalMessageId: "msg-scenario2-pdf-002",
            fromAddress: "statements@bank.com",
            subject: "Monthly Statement PDF",
            bodyText: "Attached is your PDF statement.",
            pdfBase64: buildMinimalPdfBase64(
              "Card charge USD 110.00 at Metro Airlines",
            ),
            pdfFileName: "statement-nov.pdf",
            receivedAt: new Date().toISOString(),
          },
        }),
        201,
      );

      // Balances MUST remain untouched while items are PENDING
      const untouched = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${bank.id}`),
        200,
      );
      expect(untouched.balance).toBe("2000.0000");

      // Open /inbox UI and verify BOTH pending items (ES email AND PDF statement) are visible
      const page = await context.newPage();
      await page.goto("/inbox");
      await expect(page.locator("main")).toBeVisible();
      const inboxText = await page.locator("main").innerText();
      expect(inboxText).toMatch(/Cafe Central|Compra aprobada/i);
      expect(inboxText).toMatch(/Monthly Statement|Metro Airlines/i);

      // Edit/categorize & confirm ES item; reject PDF item
      await expectOkJson(
        await owner.api.patch(`/api/inbox/${esItem.id}`, {
          data: {
            parsedAmount: "64.2500",
            parsedType: "EXPENSE",
            suggestedAccountId: bank.id,
            suggestedCategoryId: cat.id,
          },
        }),
        200,
      );
      await expectOkJson(
        await owner.api.post(`/api/inbox/${esItem.id}/confirm`, {
          data: {
            accountId: bank.id,
            categoryId: cat.id,
            type: "EXPENSE",
            amount: "64.2500",
            description: "Cafe Central",
          },
        }),
        200,
      );

      await expectOkJson(
        await owner.api.post(`/api/inbox/${pdfItem.id}/reject`),
        200,
      );

      // Verify exact balance: 2000.0000 - 64.2500 = 1935.7500
      const finalBank = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${bank.id}`),
        200,
      );
      expect(finalBank.balance).toBe("1935.7500");

      // Verify AuditLog recorded specific confirm & reject actions
      const audits = await expectPaginatedJson<AuditLogDto>(
        await owner.api.get("/api/audit-logs?page=1&pageSize=50"),
        200,
      );
      expect(
        audits.data.some(
          (a) => a.entityId === esItem.id && /CONFIRM/i.test(a.action),
        ),
      ).toBe(true);
      expect(
        audits.data.some(
          (a) => a.entityId === pdfItem.id && /REJECT/i.test(a.action),
        ),
      ).toBe(true);
    } finally {
      await context.close();
      await owner.dispose();
    }
  });

  test("Scenario 3: Subscription & Recurring Billing Cycle (Idempotent Runner, /recurring UI & CSV/JSON Export)", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1280, height: 800 },
    });
    try {
      await context.addCookies(owner.cookies);

      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Subscriptions Bank",
            type: "BANK",
            currency: "USD",
            balance: "1000.0000",
          },
        }),
        201,
      );

      const dueIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await expectOkJson<RecurringRuleDto>(
        await owner.api.post("/api/finances/recurring", {
          data: {
            name: "Netflix Ultra S3",
            type: "EXPENSE",
            amount: "22.9900",
            currency: "USD",
            accountId: acc.id,
            frequency: "MONTHLY",
            interval: 1,
            dayOfMonth: 5,
            startDate: dueIso,
            nextRunAt: dueIso,
            autoPost: true,
          },
        }),
        201,
      );
      await expectOkJson<RecurringRuleDto>(
        await owner.api.post("/api/finances/recurring", {
          data: {
            name: "GitHub Pro S3",
            type: "EXPENSE",
            amount: "10.0000",
            currency: "USD",
            accountId: acc.id,
            frequency: "MONTHLY",
            interval: 1,
            dayOfMonth: 5,
            startDate: dueIso,
            nextRunAt: dueIso,
            autoPost: true,
          },
        }),
        201,
      );

      // Run twice back-to-back to prove idempotency
      await expectOkJson(
        await owner.api.post("/api/finances/recurring/run"),
        200,
      );
      await expectOkJson(
        await owner.api.post("/api/finances/recurring/run"),
        200,
      );

      // Balance must be 1000 - 22.99 - 10.00 = 967.0100 (no double charges)
      const accAfter = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(accAfter.balance).toBe("967.0100");

      // Verify /recurring UI lists both subscriptions
      const page = await context.newPage();
      await page.goto("/recurring");
      await expect(page.locator("main")).toBeVisible();
      const recurringText = await page.locator("main").innerText();
      expect(recurringText).toContain("Netflix Ultra S3");
      expect(recurringText).toContain("GitHub Pro S3");

      // Verify CSV & JSON export contain both generated transactions
      const csvRes = await owner.api.get("/api/finances/export?format=csv");
      expect(csvRes.status()).toBe(200);
      const csv = await csvRes.text();
      expect(csv).toContain("Netflix Ultra S3");
      expect(csv).toContain("GitHub Pro S3");

      const jsonRes = await owner.api.get("/api/finances/export?format=json");
      expect(jsonRes.status()).toBe(200);
      const json = await jsonRes.text();
      expect(json).toContain("22.9900");
      expect(json).toContain("10.0000");
    } finally {
      await context.close();
      await owner.dispose();
    }
  });

  test("Scenario 4: Responsive Command Center UX (Desktop 1280x800 vs Mobile 390x844) & Dark/Light Theme Persistence", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();

    try {
      // 1. Desktop 1280x800 check
      const desktopCtx = await browser.newContext({
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 800 },
      });
      try {
        await desktopCtx.addCookies(owner.cookies);
        const desktopPage = await desktopCtx.newPage();
        await desktopPage.goto("/");
        await expect(desktopPage.locator("main")).toBeVisible();

        // Zero horizontal overflow on desktop
        const desktopOverflow = await desktopPage.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        );
        expect(desktopOverflow).toBe(true);

        // Desktop navigation links visible
        await expect(
          desktopPage.locator('a[href="/accounts"]').first(),
        ).toBeVisible();

        // Zero-FOUC dark default
        const darkLuminance =
          await measureEffectiveBackgroundLuminance(desktopPage);
        expect(darkLuminance).toBeLessThan(0.25);

        // Toggle to light theme & verify persistence across reload
        const toggleBtn = desktopPage
          .getByRole("button", { name: /tema|theme|claro|light|oscuro|dark/i })
          .first();
        await toggleBtn.click();

        await expect
          .poll(async () => {
            const settings = await expectOkJson<UserSettingsDto>(
              await owner.api.get("/api/settings"),
              200,
            );
            return settings.theme;
          })
          .toBe("LIGHT");

        await desktopPage.reload();
        await expect(desktopPage.locator("main")).toBeVisible();
        const lightLuminance =
          await measureEffectiveBackgroundLuminance(desktopPage);
        expect(lightLuminance).toBeGreaterThan(0.65);
      } finally {
        await desktopCtx.close();
      }

      // 2. Mobile 390x844 check
      const mobileCtx = await browser.newContext({
        baseURL: BASE_URL,
        viewport: { width: 390, height: 844 },
      });
      try {
        await mobileCtx.addCookies(owner.cookies);
        const mobilePage = await mobileCtx.newPage();
        await mobilePage.goto("/");
        await expect(mobilePage.locator("main")).toBeVisible();

        // Zero horizontal overflow on mobile
        const mobileOverflow = await mobilePage.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        );
        expect(mobileOverflow).toBe(true);

        // Bottom navigation bar strictly anchored at bottom of 844px viewport
        // (height <= 120, y >= 700, y + height >= 800 excludes any unhidden full-height desktop sidebar)
        const bottomNavAnchored = await mobilePage.evaluate(() => {
          const navs = Array.from(document.querySelectorAll("nav"));
          return navs.some((nav) => {
            const style = window.getComputedStyle(nav);
            const rect = nav.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.height > 30 &&
              rect.height <= 120 &&
              rect.y >= 700 &&
              rect.y + rect.height >= 800
            );
          });
        });
        expect(bottomNavAnchored).toBe(true);
      } finally {
        await mobileCtx.close();
      }
    } finally {
      await owner.dispose();
    }
  });

  test("Scenario 5: PWA Installability & Offline Resilience (Manifest, PNG Icons, SW Registration, /offline & Network-Only /api/*)", async ({
    browser,
  }) => {
    const owner = await resetAndCreateOwnerSession();
    const anon = await createUnauthenticatedApi();
    const context = await browser.newContext({ baseURL: BASE_URL });

    try {
      // 1. Public manifest & PNG magic-byte verification
      const manifestRes = await anon.get("/manifest.webmanifest");
      expect(manifestRes.status()).toBe(200);
      const manifest = (await manifestRes.json()) as {
        name?: string;
        display?: string;
        start_url?: string;
        icons?: Array<{ src: string }>;
      };
      expect(manifest.display).toBe("standalone");
      expect(manifest.start_url).toBe("/");

      for (const iconPath of ["/icons/icon-192.png", "/icons/icon-512.png"]) {
        const res = await anon.get(iconPath);
        expect(res.status()).toBe(200);
        expect(isValidPngHeader(await res.body())).toBe(true);
      }

      // 2. Public /sw.js headers & /offline accessibility without auth
      const swRes = await anon.get("/sw.js");
      expect(swRes.status()).toBe(200);
      expect(swRes.headers()["cache-control"] ?? "").toMatch(
        /no-cache|no-store|max-age=0/i,
      );
      const offlineRes = await anon.get("/offline");
      expect(offlineRes.status()).toBe(200);

      // 3. Register SW in Chromium, go offline, verify /api/* fails (Network-Only) and navigation falls back to /offline
      await context.addCookies(owner.cookies);
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator("main")).toBeVisible();

      const swReady = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) {
          return false;
        }
        const reg = await navigator.serviceWorker.ready;
        return Boolean(reg.active);
      });
      expect(swReady).toBe(true);

      // Ensure the page is actively controlled by the Service Worker (reload once if needed)
      const controlledInitially = await page.evaluate(() =>
        Boolean(navigator.serviceWorker.controller),
      );
      if (!controlledInitially) {
        await page.reload({ waitUntil: "networkidle" });
      }
      const controlled = await page.evaluate(() =>
        Boolean(navigator.serviceWorker.controller),
      );
      expect(controlled).toBe(true);

      // Warm GET /api/finances/accounts while ONLINE so offline failure genuinely proves Network-Only /api/*
      const onlineApiStatus = await page.evaluate(async () => {
        const res = await fetch("/api/finances/accounts");
        return res.status;
      });
      expect(onlineApiStatus).toBe(200);

      await context.setOffline(true);

      // Sensitive /api/* MUST NOT be served from SW cache when offline
      const apiFailedOffline = await page.evaluate(async () => {
        try {
          const res = await fetch("/api/finances/accounts");
          return !res.ok;
        } catch {
          return true;
        }
      });
      expect(apiFailedOffline).toBe(true);

      // Navigating while offline MUST be served cleanly by the SW with HTTP 200 (never chrome-error://)
      const navRes = await page.goto("/accounts", {
        waitUntil: "domcontentloaded",
      });
      expect(navRes).not.toBeNull();
      expect(navRes?.status()).toBe(200);
      expect(page.url().startsWith("chrome-error://")).toBe(false);
      const offlineBody = await page.evaluate(
        () => document.body?.innerText ?? "",
      );
      expect(offlineBody).toMatch(/offline|sin conexi[oó]n|desconectado/i);
    } finally {
      await context.setOffline(false).catch(() => undefined);
      await context.close();
      await anon.dispose();
      await owner.dispose();
    }
  });

  test("Scenario 6: Security & Access Control Audit (401/403, Redirects, Passkey/WebAuthn UI on /login & /settings)", async ({
    browser,
  }) => {
    // 1. Unauthenticated API 401 & protected page redirect -> /login
    const anon = await createUnauthenticatedApi();
    const anonCtx = await browser.newContext({ baseURL: BASE_URL });
    try {
      await expectErrorJson(
        await anon.get("/api/finances/dashboard"),
        401,
        "UNAUTHORIZED",
      );

      const page = await anonCtx.newPage();
      await page.goto("/settings");
      await page.waitForURL("**/login");
      expect(new URL(page.url()).pathname).toBe("/login");

      // /login renders Google OAuth & Passkey sign-in options
      const loginText = await page.locator("body").innerText();
      expect(loginText).toMatch(/google/i);
      expect(loginText).toMatch(/passkey|biometr|llave/i);
    } finally {
      await anonCtx.close();
      await anon.dispose();
    }

    // 2. Unauthorized email session -> 403 FORBIDDEN on APIs
    const forbidden = await createForbiddenSession();
    try {
      await expectErrorJson(
        await forbidden.api.get("/api/finances/dashboard"),
        403,
        "FORBIDDEN",
      );
      await expectErrorJson(
        await forbidden.api.get("/api/inbox"),
        403,
        "FORBIDDEN",
      );
    } finally {
      await forbidden.dispose();
    }

    // 3. Authenticated owner opens /settings and sees Passkey device management UI
    const owner = await resetAndCreateOwnerSession();
    const ownerCtx = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1280, height: 800 },
    });
    try {
      await ownerCtx.addCookies(owner.cookies);
      const page = await ownerCtx.newPage();
      await page.goto("/settings");
      await expect(page.locator("main")).toBeVisible();

      const settingsText = await page.locator("main").innerText();
      expect(settingsText).toMatch(/passkey|biometr|llave/i);
      await expect(
        page
          .getByRole("button", { name: /passkey|biometr|vincular|registrar|add/i })
          .first(),
      ).toBeVisible();
    } finally {
      await ownerCtx.close();
      await owner.dispose();
    }
  });
});
