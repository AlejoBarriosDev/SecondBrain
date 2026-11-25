import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  createForbiddenSession,
  createUnauthenticatedApi,
  expectErrorJson,
  expectOkJson,
  resetAndCreateOwnerSession,
  type BudgetDto,
  type CategoryDto,
  type EmailImportItemDto,
  type FinancialAccountDto,
  type RecurringRuleDto,
  type TagDto,
} from "./fixtures";

test.describe("Tier 2 — Boundary Values, Corner Cases & Error Contracts", () => {
  test("Decimal(19,4) exact precision: tiny, large, carry-over & zero float drift (0.1 + 0.2 = 0.3000)", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      // Zero float drift: 0.1000 + 0.2000 = 0.3000
      const driftAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Precision Checking",
            type: "BANK",
            currency: "USD",
            balance: "0.0000",
          },
        }),
        201,
      );

      for (const amount of ["0.1", "0.2", "0.0001", "19.9950", "0.0050"]) {
        await expectOkJson(
          await owner.api.post("/api/finances/transactions", {
            data: {
              accountId: driftAcc.id,
              type: "INCOME",
              amount,
              currency: "USD",
              occurredAt: new Date().toISOString(),
              description: `Precision add ${amount}`,
            },
          }),
          201,
        );
      }

      // 0.1 + 0.2 + 0.0001 + 19.9950 + 0.0050 = 20.3001
      const updatedDriftAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${driftAcc.id}`),
        200,
      );
      expect(updatedDriftAcc.balance).toBe("20.3001");

      // Large Decimal(19,4) value without IEEE-754 precision loss
      const largeAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Treasury Vault",
            type: "BANK",
            currency: "USD",
            balance: "999999999999.9999",
          },
        }),
        201,
      );
      expect(largeAcc.balance).toBe("999999999999.9999");
    } finally {
      await owner.dispose();
    }
  });

  test("Rejects zero, negative, >4 decimals, non-numeric amounts & malformed JSON with 400", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Validation Account",
            type: "BANK",
            currency: "USD",
            balance: "500.0000",
          },
        }),
        201,
      );

      const invalidAmounts = ["0", "0.0000", "-10.00", "1.12345", "NaN", "abc"];
      for (const badAmount of invalidAmounts) {
        const res = await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: acc.id,
            type: "EXPENSE",
            amount: badAmount,
            currency: "USD",
            occurredAt: new Date().toISOString(),
            description: `Bad amount ${badAmount}`,
          },
        });
        await expectErrorJson(res, 400, "VALIDATION_ERROR");
      }

      // Malformed JSON body
      const malformedRes = await owner.api.post("/api/finances/transactions", {
        headers: { "content-type": "application/json" },
        data: "{not-valid-json",
      });
      const err = await expectErrorJson(malformedRes, 400);
      expect(["INVALID_JSON", "VALIDATION_ERROR"]).toContain(err.code);

      // Account balance remains completely untouched
      const unchanged = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${acc.id}`),
        200,
      );
      expect(unchanged.balance).toBe("500.0000");
    } finally {
      await owner.dispose();
    }
  });

  test("Rejects self-transfer (400) and mutations on archived accounts (400/409)", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const activeAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Active Bank",
            type: "BANK",
            currency: "USD",
            balance: "1000.0000",
          },
        }),
        201,
      );
      const archivedAcc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Old Closed Bank",
            type: "BANK",
            currency: "USD",
            balance: "100.0000",
          },
        }),
        201,
      );

      // Archive second account
      await expectOkJson(
        await owner.api.delete(`/api/finances/accounts/${archivedAcc.id}`),
        200,
      );

      // Self-transfer rejected with 400
      const selfTransferRes = await owner.api.post("/api/finances/transfers", {
        data: {
          fromAccountId: activeAcc.id,
          toAccountId: activeAcc.id,
          amount: "50.0000",
          occurredAt: new Date().toISOString(),
          description: "Invalid self transfer",
        },
      });
      await expectErrorJson(selfTransferRes, 400);

      // Transaction on archived account rejected (400 or 409)
      const archivedTxRes = await owner.api.post("/api/finances/transactions", {
        data: {
          accountId: archivedAcc.id,
          type: "EXPENSE",
          amount: "10.0000",
          currency: "USD",
          occurredAt: new Date().toISOString(),
          description: "Should fail on archived account",
        },
      });
      expect([400, 409]).toContain(archivedTxRes.status());
      const archivedTxErr = await expectErrorJson(
        archivedTxRes,
        archivedTxRes.status(),
      );
      expect(archivedTxErr.message.length).toBeGreaterThan(0);

      // Transfer involving archived account rejected (400 or 409)
      const archivedTransferRes = await owner.api.post(
        "/api/finances/transfers",
        {
          data: {
            fromAccountId: activeAcc.id,
            toAccountId: archivedAcc.id,
            amount: "25.0000",
            occurredAt: new Date().toISOString(),
            description: "Should fail to archived account",
          },
        },
      );
      expect([400, 409]).toContain(archivedTransferRes.status());
      await expectErrorJson(archivedTransferRes, archivedTransferRes.status());
    } finally {
      await owner.dispose();
    }
  });

  test("Rejects self-link on /api/entity-links (400) and duplicate tag name (409)", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const selfLinkRes = await owner.api.post("/api/entity-links", {
        data: {
          sourceType: "TRANSACTION",
          sourceId: "same-entity-id",
          targetType: "TRANSACTION",
          targetId: "same-entity-id",
          relationType: "SELF_LOOP",
        },
      });
      const linkErr = await expectErrorJson(
        selfLinkRes,
        400,
        "VALIDATION_ERROR",
      );
      expect(linkErr.fieldErrors).toBeDefined();

      // Duplicate tag name -> 409 CONFLICT
      const tag1 = await expectOkJson<TagDto>(
        await owner.api.post("/api/tags", {
          data: { name: "UniqueTagName", color: "#6366f1" },
        }),
        201,
      );
      expect(tag1.name).toBe("UniqueTagName");

      const dupTagRes = await owner.api.post("/api/tags", {
        data: { name: "UniqueTagName", color: "#ef4444" },
      });
      await expectErrorJson(dupTagRes, 409, "CONFLICT");
    } finally {
      await owner.dispose();
    }
  });

  test("F-AUTH-01/02: Auth boundaries — unauthenticated 401, forbidden email 403 & page redirect to /login", async ({
    browser,
  }) => {
    const anon = await createUnauthenticatedApi();
    try {
      // Unauthenticated API -> 401
      const unauthFinance = await anon.get("/api/finances/accounts");
      await expectErrorJson(unauthFinance, 401, "UNAUTHORIZED");

      const unauthInbox = await anon.get("/api/inbox");
      await expectErrorJson(unauthInbox, 401, "UNAUTHORIZED");

      // Unauthenticated protected page -> redirect to /login
      const anonContext = await browser.newContext({ baseURL: BASE_URL });
      try {
        const page = await anonContext.newPage();
        await page.goto("/accounts");
        await page.waitForURL("**/login");
        expect(new URL(page.url()).pathname).toBe("/login");
      } finally {
        await anonContext.close();
      }
    } finally {
      await anon.dispose();
    }

    // Unauthorized email session -> 403 FORBIDDEN on APIs
    const forbidden = await createForbiddenSession();
    try {
      const settingsRes = await forbidden.api.get("/api/settings");
      await expectErrorJson(settingsRes, 403, "FORBIDDEN");

      const accountsRes = await forbidden.api.get("/api/finances/accounts");
      await expectErrorJson(accountsRes, 403, "FORBIDDEN");

      const forbiddenContext = await browser.newContext({ baseURL: BASE_URL });
      try {
        await forbiddenContext.addCookies(forbidden.cookies);
        const page = await forbiddenContext.newPage();
        await page.goto("/accounts");
        await page.waitForURL("**/login");
        expect(new URL(page.url()).pathname).toBe("/login");
      } finally {
        await forbiddenContext.close();
      }
    } finally {
      await forbidden.dispose();
    }
  });

  test("Missing required fields return 400 VALIDATION_ERROR with fieldErrors & unknown IDs return 404 NOT_FOUND", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const invalidAccountRes = await owner.api.post("/api/finances/accounts", {
        data: { name: "" },
      });
      const valErr = await expectErrorJson(
        invalidAccountRes,
        400,
        "VALIDATION_ERROR",
      );
      expect(valErr.fieldErrors).toBeDefined();

      const notFoundAcc = await owner.api.get(
        "/api/finances/accounts/nonexistent-id-12345",
      );
      await expectErrorJson(notFoundAcc, 404, "NOT_FOUND");

      const notFoundTx = await owner.api.delete(
        "/api/finances/transactions/nonexistent-tx-12345",
      );
      await expectErrorJson(notFoundTx, 404, "NOT_FOUND");

      const notFoundInbox = await owner.api.get(
        "/api/inbox/nonexistent-item-12345",
      );
      await expectErrorJson(notFoundInbox, 404, "NOT_FOUND");
    } finally {
      await owner.dispose();
    }
  });

  test("INBOX-02 & F-FIN-02: Double-confirm 409, rejected-confirm 409, concurrent double-confirm race & parallel opposite transfers", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const accA = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Race Bank A",
            type: "BANK",
            currency: "USD",
            balance: "1000.0000",
          },
        }),
        201,
      );
      const accB = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Race Bank B",
            type: "BANK",
            currency: "USD",
            balance: "1000.0000",
          },
        }),
        201,
      );

      // 1. Sequential double-confirm -> second returns 409
      const item1 = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", {
          data: {
            externalMessageId: "msg-double-confirm-1",
            subject: "Charge $25.00 at Coffee",
            bodyText: "Purchase of $25.00 USD at Coffee Shop",
            receivedAt: new Date().toISOString(),
          },
        }),
        201,
      );

      const firstConfirm = await owner.api.post(
        `/api/inbox/${item1.id}/confirm`,
        {
          data: {
            accountId: accA.id,
            type: "EXPENSE",
            amount: "25.0000",
            description: "Coffee Shop",
          },
        },
      );
      await expectOkJson(firstConfirm, 200);

      const secondConfirm = await owner.api.post(
        `/api/inbox/${item1.id}/confirm`,
        {
          data: {
            accountId: accA.id,
            type: "EXPENSE",
            amount: "25.0000",
            description: "Coffee Shop duplicate",
          },
        },
      );
      await expectErrorJson(secondConfirm, 409, "CONFLICT");

      // 2. Confirming a REJECTED item -> 409
      const item2 = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", {
          data: {
            externalMessageId: "msg-reject-then-confirm-2",
            subject: "Charge $15.00 at News",
            bodyText: "Purchase of $15.00 USD at News",
            receivedAt: new Date().toISOString(),
          },
        }),
        201,
      );
      await expectOkJson(
        await owner.api.post(`/api/inbox/${item2.id}/reject`),
        200,
      );
      const confirmRejected = await owner.api.post(
        `/api/inbox/${item2.id}/confirm`,
        {
          data: {
            accountId: accA.id,
            type: "EXPENSE",
            amount: "15.0000",
            description: "Should fail",
          },
        },
      );
      await expectErrorJson(confirmRejected, 409, "CONFLICT");

      // 3. Concurrent double-confirm race -> exactly one 200 and one 409
      const item3 = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", {
          data: {
            externalMessageId: "msg-concurrent-confirm-3",
            subject: "Charge $50.00 at Hardware",
            bodyText: "Purchase of $50.00 USD at Hardware Store",
            receivedAt: new Date().toISOString(),
          },
        }),
        201,
      );

      const confirmPayload = {
        data: {
          accountId: accA.id,
          type: "EXPENSE",
          amount: "50.0000",
          description: "Concurrent Confirm",
        },
      };
      const [race1, race2] = await Promise.all([
        owner.api.post(`/api/inbox/${item3.id}/confirm`, confirmPayload),
        owner.api.post(`/api/inbox/${item3.id}/confirm`, confirmPayload),
      ]);
      const raceStatuses = [race1.status(), race2.status()].sort(
        (a, b) => a - b,
      );
      expect(raceStatuses).toEqual([200, 409]);

      // Balance of accA must be 1000 - 25 - 50 = 925.0000 (not 875.0000)
      const accAAfterConfirm = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${accA.id}`),
        200,
      );
      expect(accAAfterConfirm.balance).toBe("925.0000");

      // 4. Parallel opposite-direction transfers (A->B and B->A) — zero deadlocks, exact conservation
      const nowIso = new Date().toISOString();
      const parallelTransfers = await Promise.all([
        owner.api.post("/api/finances/transfers", {
          data: {
            fromAccountId: accA.id,
            toAccountId: accB.id,
            amount: "100.0000",
            occurredAt: nowIso,
            description: "Parallel A->B #1",
          },
        }),
        owner.api.post("/api/finances/transfers", {
          data: {
            fromAccountId: accB.id,
            toAccountId: accA.id,
            amount: "40.0000",
            occurredAt: nowIso,
            description: "Parallel B->A #1",
          },
        }),
        owner.api.post("/api/finances/transfers", {
          data: {
            fromAccountId: accA.id,
            toAccountId: accB.id,
            amount: "25.0000",
            occurredAt: nowIso,
            description: "Parallel A->B #2",
          },
        }),
        owner.api.post("/api/finances/transfers", {
          data: {
            fromAccountId: accB.id,
            toAccountId: accA.id,
            amount: "10.0000",
            occurredAt: nowIso,
            description: "Parallel B->A #2",
          },
        }),
      ]);

      for (const res of parallelTransfers) {
        expect(res.status(), await res.text()).toBe(201);
      }

      // Expected: accA = 925 - 100 + 40 - 25 + 10 = 850.0000; accB = 1000 + 100 - 40 + 25 - 10 = 1075.0000
      const finalA = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${accA.id}`),
        200,
      );
      const finalB = await expectOkJson<FinancialAccountDto>(
        await owner.api.get(`/api/finances/accounts/${accB.id}`),
        200,
      );
      expect(finalA.balance).toBe("850.0000");
      expect(finalB.balance).toBe("1075.0000");
    } finally {
      await owner.dispose();
    }
  });

  test("PARSE-03 / PARSE-01 / GMAIL-03: Ambiguous email without LLM_API_KEY, corrupt PDF & duplicate externalMessageId deduplication", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      // 1. Ambiguous unstructured text -> lands as PENDING without 500
      const ambiguousRes = await owner.api.post("/api/inbox/ingest", {
        data: {
          externalMessageId: "msg-ambiguous-no-llm-1",
          fromAddress: "friend@example.com",
          subject: "Hey quick note",
          bodyText: "Let's catch up sometime next week for lunch.",
          receivedAt: new Date().toISOString(),
        },
      });
      const ambiguousItem = await expectOkJson<EmailImportItemDto>(
        ambiguousRes,
        201,
      );
      expect(ambiguousItem.status).toBe("PENDING");

      // 2. Corrupt base64 PDF -> degrades gracefully (no 404/405/500)
      const corruptPdfRes = await owner.api.post("/api/inbox/ingest", {
        data: {
          externalMessageId: "msg-corrupt-pdf-1",
          fromAddress: "bank@example.com",
          subject: "Corrupted statement",
          bodyText: "See attached PDF.",
          pdfBase64: Buffer.from("NOT_A_REAL_PDF_BINARY_DATA").toString(
            "base64",
          ),
          pdfFileName: "corrupt.pdf",
          receivedAt: new Date().toISOString(),
        },
      });
      expect([200, 201, 400, 422]).toContain(corruptPdfRes.status());
      const corruptPdfBody = (await corruptPdfRes.json()) as { ok?: unknown };
      expect(typeof corruptPdfBody.ok).toBe("boolean");

      // 3. Duplicate externalMessageId deduplicates idempotently
      const dupPayload = {
        data: {
          externalMessageId: "msg-dedup-unique-999",
          fromAddress: "alerts@bank.test",
          subject: "Purchase alert $12.34 at Bakery",
          bodyText: "Card purchase of $12.34 USD at Local Bakery.",
          receivedAt: new Date().toISOString(),
        },
      };
      const firstIngest = await expectOkJson<EmailImportItemDto>(
        await owner.api.post("/api/inbox/ingest", dupPayload),
        201,
      );
      const secondIngestRes = await owner.api.post(
        "/api/inbox/ingest",
        dupPayload,
      );
      expect([200, 201, 409]).toContain(secondIngestRes.status());

      const allPending = await expectOkJson<EmailImportItemDto[]>(
        await owner.api.get("/api/inbox?status=PENDING"),
        200,
      );
      const matching = allPending.filter(
        (item) => item.externalMessageId === "msg-dedup-unique-999",
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]?.id).toBe(firstIngest.id);
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-04: Budget alert thresholds — below 80% normal, >= 80% warning, >= 100% exceeded", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "Budget Bank",
            type: "BANK",
            currency: "USD",
            balance: "2000.0000",
          },
        }),
        201,
      );
      const cat = await expectOkJson<CategoryDto>(
        await owner.api.post("/api/finances/categories", {
          data: { name: "Entertainment Thresholds", type: "EXPENSE" },
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
            amount: "100.0000",
            currency: "USD",
            alertThresholdPct: 80,
          },
        }),
        201,
      );

      const fetchBudget = async (): Promise<BudgetDto> => {
        const list = await expectOkJson<BudgetDto[]>(
          await owner.api.get(
            `/api/finances/budgets?year=${year}&month=${month}`,
          ),
          200,
        );
        const found = list.find((b) => b.categoryId === cat.id);
        expect(found).toBeDefined();
        return found as BudgetDto;
      };

      // Stage 1: Spend 50.0000 (50% -> below 80% normal)
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: acc.id,
            categoryId: cat.id,
            type: "EXPENSE",
            amount: "50.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "Movie tickets",
          },
        }),
        201,
      );
      const b50 = await fetchBudget();
      expect(b50.spent).toBe("50.0000");
      const pct50 = b50.percentUsed ?? b50.usagePct;
      expect(pct50).toBeDefined();
      expect(typeof pct50).toBe("number");
      expect(pct50!).toBeLessThan(80);
      if (b50.alertStatus !== undefined) {
        expect(b50.alertStatus).toBe("OK");
      }

      // Stage 2: Spend +35.0000 -> 85.0000 (85% -> warning)
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: acc.id,
            categoryId: cat.id,
            type: "EXPENSE",
            amount: "35.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "Concert pass",
          },
        }),
        201,
      );
      const b85 = await fetchBudget();
      expect(b85.spent).toBe("85.0000");
      const pct85 = b85.percentUsed ?? b85.usagePct;
      expect(pct85).toBeDefined();
      expect(typeof pct85).toBe("number");
      expect(pct85!).toBeGreaterThanOrEqual(80);
      expect(pct85!).toBeLessThan(100);
      if (b85.alertStatus !== undefined) {
        expect(b85.alertStatus).toBe("WARNING");
      }

      // Stage 3: Spend +25.0000 -> 110.0000 (110% -> exceeded)
      await expectOkJson(
        await owner.api.post("/api/finances/transactions", {
          data: {
            accountId: acc.id,
            categoryId: cat.id,
            type: "EXPENSE",
            amount: "25.0000",
            currency: "USD",
            occurredAt: now.toISOString(),
            description: "Streaming addon",
          },
        }),
        201,
      );
      const b110 = await fetchBudget();
      expect(b110.spent).toBe("110.0000");
      const pct110 = b110.percentUsed ?? b110.usagePct;
      expect(pct110).toBeDefined();
      expect(typeof pct110).toBe("number");
      expect(pct110!).toBeGreaterThanOrEqual(100);
      if (b110.alertStatus !== undefined) {
        expect(b110.alertStatus).toBe("EXCEEDED");
      }
    } finally {
      await owner.dispose();
    }
  });

  test("F-FIN-05: Month-end recurring rule clamping (dayOfMonth: 31 advances into February without skipping)", async () => {
    const owner = await resetAndCreateOwnerSession();
    try {
      const acc = await expectOkJson<FinancialAccountDto>(
        await owner.api.post("/api/finances/accounts", {
          data: {
            name: "MonthEnd Bank",
            type: "BANK",
            currency: "USD",
            balance: "1000.0000",
          },
        }),
        201,
      );

      // Create a rule due on Jan 31, 2025 (past date) with dayOfMonth = 31
      const jan31 = "2025-01-31T12:00:00.000Z";
      const rule = await expectOkJson<RecurringRuleDto>(
        await owner.api.post("/api/finances/recurring", {
          data: {
            name: "Month-End Rent",
            type: "EXPENSE",
            amount: "100.0000",
            currency: "USD",
            accountId: acc.id,
            frequency: "MONTHLY",
            interval: 1,
            dayOfMonth: 31,
            startDate: jan31,
            nextRunAt: jan31,
            autoPost: true,
          },
        }),
        201,
      );

      await expectOkJson(
        await owner.api.post("/api/finances/recurring/run"),
        200,
      );

      const rules = await expectOkJson<RecurringRuleDto[]>(
        await owner.api.get("/api/finances/recurring"),
        200,
      );
      const updatedRule = rules.find((r) => r.id === rule.id);
      expect(updatedRule).toBeDefined();

      const nextDate = new Date((updatedRule as RecurringRuleDto).nextRunAt);
      // After running Jan 31, 2025, nextRunAt must clamp to Feb 28, 2025 (UTC month index 1, NOT March = 2)
      expect(nextDate.getUTCFullYear()).toBe(2025);
      expect(nextDate.getUTCMonth()).toBe(1);
      expect(nextDate.getUTCDate()).toBe(28);
    } finally {
      await owner.dispose();
    }
  });
});
