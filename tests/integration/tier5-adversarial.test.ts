import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  EntityType,
  FinancialAccountType,
  RecurrenceFrequency,
  TransactionType,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatDecimal } from "@/lib/db/decimal";
import { createAccount } from "@/modules/finances/accounts";
import { createCategory } from "@/modules/finances/categories";
import { upsertBudget } from "@/modules/finances/budgets";
import { createRecurringRule } from "@/modules/finances/recurring";
import { createTransaction } from "@/modules/finances/transactions";
import { createTransfer } from "@/modules/finances/transfers";
import { createTag, attachTag } from "@/modules/core/tags";
import { createEntityLink } from "@/modules/core/entity-links";
import { GET as getTagsRoute } from "@/app/api/tags/route";
import { GET as getEntityLinksRoute } from "@/app/api/entity-links/route";
import { POST as createTransactionRoute } from "@/app/api/finances/transactions/route";
import {
  DELETE as deleteTransactionRoute,
  PATCH as patchTransactionRoute,
} from "@/app/api/finances/transactions/[id]/route";
import { POST as createTransferRoute } from "@/app/api/finances/transfers/route";
import { DELETE as deleteTransferRoute } from "@/app/api/finances/transfers/[transferGroupId]/route";
import { DELETE as deleteCategoryRoute } from "@/app/api/finances/categories/[id]/route";
import { DELETE as deleteBudgetRoute } from "@/app/api/finances/budgets/[id]/route";
import {
  DELETE as deleteRecurringRoute,
  PATCH as patchRecurringRoute,
} from "@/app/api/finances/recurring/[id]/route";
import { POST as runRecurringRoute } from "@/app/api/finances/recurring/run/route";
import { POST as ingestInboxRoute } from "@/app/api/inbox/ingest/route";
import { POST as syncInboxRoute } from "@/app/api/inbox/sync/route";
import { PATCH as patchInboxItemRoute } from "@/app/api/inbox/[id]/route";
import { POST as confirmInboxItemRoute } from "@/app/api/inbox/[id]/confirm/route";
import { POST as rejectInboxItemRoute } from "@/app/api/inbox/[id]/reject/route";
import { resetTestDatabase } from "../helpers/db-reset";
import { getTestAuthHelpers } from "../helpers/test-auth";

function makeRequest(
  url: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const headers = new Headers(options.headers);
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    headers.set("content-type", "application/json");
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body,
  });
}

describe("Tier 5 Adversarial — Real PostgreSQL & API Integration Tests", () => {
  let userId: string;
  let cookieHeader: string;

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.ALLOWED_EMAIL = "owner@secondbrain.local";

    const tu = await getTestAuthHelpers();
    const saved = await tu.saveUser(
      tu.createUser({
        email: "owner@secondbrain.local",
        name: "Tier5 Owner",
      }),
    );
    userId = saved.id;
    const login = await tu.login({ userId: saved.id });
    cookieHeader = login.headers.get("cookie") ?? "";
  });

  it("re-anchors multi-month recurring dayOfMonth=31 across Feb -> Mar 31 -> Apr 30 in Postgres", async () => {
    const account = await createAccount(userId, {
      name: "Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });

    const rule = await createRecurringRule(userId, {
      name: "Month-End Subscription",
      type: TransactionType.EXPENSE,
      amount: "10.0000",
      currency: "USD",
      accountId: account.id,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      dayOfMonth: 31,
      startDate: "2026-01-31T00:00:00.000Z",
      nextRunAt: "2026-01-31T00:00:00.000Z",
      autoPost: true,
    });

    // Run 1: Jan 31 -> Feb 28
    const r1 = await (
      await runRecurringRoute(
        makeRequest("http://localhost:3000/api/finances/recurring/run", {
          method: "POST",
          cookie: cookieHeader,
          body: { now: "2026-02-01T00:00:00.000Z" },
        }),
      )
    ).json();
    expect(r1.ok).toBe(true);
    expect(r1.data.results[0].nextRunAt).toBe("2026-02-28T00:00:00.000Z");

    // Run 2: Feb 28 -> Mar 31 (no drift to Mar 28!)
    const r2 = await (
      await runRecurringRoute(
        makeRequest("http://localhost:3000/api/finances/recurring/run", {
          method: "POST",
          cookie: cookieHeader,
          body: { now: "2026-03-01T00:00:00.000Z" },
        }),
      )
    ).json();
    expect(r2.ok).toBe(true);
    expect(r2.data.results[0].nextRunAt).toBe("2026-03-31T00:00:00.000Z");

    // Run 3: Mar 31 -> Apr 30
    const r3 = await (
      await runRecurringRoute(
        makeRequest("http://localhost:3000/api/finances/recurring/run", {
          method: "POST",
          cookie: cookieHeader,
          body: { now: "2026-04-01T00:00:00.000Z" },
        }),
      )
    ).json();
    expect(r3.ok).toBe(true);
    expect(r3.data.results[0].nextRunAt).toBe("2026-04-30T00:00:00.000Z");

    const updatedRule = await prisma.recurringRule.findUniqueOrThrow({
      where: { id: rule.id },
    });
    expect(updatedRule.nextRunAt.toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("authenticates POST /api/finances/recurring/run with CRON_SECRET Bearer and rejects invalid Bearer", async () => {
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "tier5-cron-secret-value";
    try {
      const badRes = await runRecurringRoute(
        makeRequest("http://localhost:3000/api/finances/recurring/run", {
          method: "POST",
          headers: { authorization: "Bearer wrong-secret" },
        }),
      );
      expect(badRes.status).toBe(401);

      const goodRes = await runRecurringRoute(
        makeRequest("http://localhost:3000/api/finances/recurring/run", {
          method: "POST",
          headers: { authorization: "Bearer tier5-cron-secret-value" },
        }),
      );
      expect(goodRes.status).toBe(200);
      const body = await goodRes.json();
      expect(body.ok).toBe(true);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = prevSecret;
      }
    }
  });

  it("returns 400 VALIDATION_ERROR (not 500) with atomic rollback on Decimal(19,4) balance overflow", async () => {
    const nearMax = await createAccount(userId, {
      name: "Near Max Account",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "999999999999990.0000",
    });
    const source = await createAccount(userId, {
      name: "Source Account",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    // 1. Transaction create overflow
    const txRes = await createTransactionRoute(
      makeRequest("http://localhost:3000/api/finances/transactions", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          accountId: nearMax.id,
          type: TransactionType.INCOME,
          amount: "100.0000",
          description: "Overflow income",
        },
      }),
    );
    expect(txRes.status).toBe(400);
    const txBody = await txRes.json();
    expect(txBody.error.code).toBe("VALIDATION_ERROR");

    // 2. Transfer create overflow
    const xferRes = await createTransferRoute(
      makeRequest("http://localhost:3000/api/finances/transfers", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          fromAccountId: source.id,
          toAccountId: nearMax.id,
          amount: "100.0000",
        },
      }),
    );
    expect(xferRes.status).toBe(400);
    const xferBody = await xferRes.json();
    expect(xferBody.error.code).toBe("VALIDATION_ERROR");

    // 3. Recurring run overflow
    const dueRule = await createRecurringRule(userId, {
      name: "Overflow Recurring",
      type: TransactionType.INCOME,
      amount: "100.0000",
      currency: "USD",
      accountId: nearMax.id,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: "2026-01-01T00:00:00.000Z",
      nextRunAt: "2026-01-01T00:00:00.000Z",
      autoPost: true,
    });

    const runRes = await runRecurringRoute(
      makeRequest("http://localhost:3000/api/finances/recurring/run", {
        method: "POST",
        cookie: cookieHeader,
        body: { now: "2026-01-02T00:00:00.000Z" },
      }),
    );
    expect(runRes.status).toBe(400);
    const runBody = await runRes.json();
    expect(runBody.error.code).toBe("VALIDATION_ERROR");

    // Verify full atomic rollback across all 3 attempts
    const reloadedNearMax = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: nearMax.id },
    });
    const reloadedSource = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: source.id },
    });
    const reloadedRule = await prisma.recurringRule.findUniqueOrThrow({
      where: { id: dueRule.id },
    });
    expect(formatDecimal(reloadedNearMax.balance)).toBe("999999999999990.0000");
    expect(formatDecimal(reloadedSource.balance)).toBe("500.0000");
    expect(reloadedRule.nextRunAt.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
  });

  it("cleans up polymorphic EntityTag, EntityLink, and Attachment on hard-delete of Transaction, Transfer, Category (+ cascaded Budget), Budget, and RecurringRule", async () => {
    const accA = await createAccount(userId, {
      name: "Account A",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });
    const accB = await createAccount(userId, {
      name: "Account B",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });
    const anchorAcc = await createAccount(userId, {
      name: "Anchor Account",
      type: FinancialAccountType.CASH,
      currency: "USD",
      balance: "100.0000",
    });
    const tag = await createTag(userId, {
      name: "cleanup-tag",
      color: "#6366f1",
    });

    // Helper to attach tag + outgoing link + incoming link + attachment
    const attachAllRefs = async (entityType: EntityType, entityId: string) => {
      await attachTag(userId, { tagId: tag.id, entityType, entityId });
      await createEntityLink(userId, {
        sourceType: entityType,
        sourceId: entityId,
        targetType: EntityType.FINANCIAL_ACCOUNT,
        targetId: anchorAcc.id,
        relationType: "RELATED",
      });
      await createEntityLink(userId, {
        sourceType: EntityType.FINANCIAL_ACCOUNT,
        sourceId: anchorAcc.id,
        targetType: entityType,
        targetId: entityId,
        relationType: "RELATED",
      });
      await prisma.attachment.create({
        data: {
          userId,
          entityType,
          entityId,
          fileName: `${entityId}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 128,
          storageKey: `test://${entityId}`,
        },
      });
    };

    const assertZeroRefs = async (entityType: EntityType, entityId: string) => {
      expect(
        await prisma.entityTag.count({
          where: { userId, entityType, entityId },
        }),
      ).toBe(0);
      expect(
        await prisma.entityLink.count({
          where: {
            userId,
            OR: [
              { sourceType: entityType, sourceId: entityId },
              { targetType: entityType, targetId: entityId },
            ],
          },
        }),
      ).toBe(0);
      expect(
        await prisma.attachment.count({
          where: { userId, entityType, entityId },
        }),
      ).toBe(0);
    };

    // Unrelated anchor refs that must remain untouched
    await attachTag(userId, {
      tagId: tag.id,
      entityType: EntityType.FINANCIAL_ACCOUNT,
      entityId: anchorAcc.id,
    });

    // 1. Transaction
    const tx = await createTransaction(userId, {
      accountId: accA.id,
      type: TransactionType.EXPENSE,
      amount: "25.0000",
      description: "Delete me",
    });
    await attachAllRefs(EntityType.TRANSACTION, tx.id);
    const delTxRes = await deleteTransactionRoute(
      makeRequest(`http://localhost:3000/api/finances/transactions/${tx.id}`, {
        method: "DELETE",
        cookie: cookieHeader,
      }),
      { params: Promise.resolve({ id: tx.id }) },
    );
    expect(delTxRes.status).toBe(200);
    await assertZeroRefs(EntityType.TRANSACTION, tx.id);

    // 2. Transfer (both legs)
    const xfer = await createTransfer(userId, {
      fromAccountId: accA.id,
      toAccountId: accB.id,
      amount: "50.0000",
    });
    await attachAllRefs(EntityType.TRANSACTION, xfer.outTransaction.id);
    await attachAllRefs(EntityType.TRANSACTION, xfer.inTransaction.id);
    const delXferRes = await deleteTransferRoute(
      makeRequest(
        `http://localhost:3000/api/finances/transfers/${xfer.transferGroupId}`,
        { method: "DELETE", cookie: cookieHeader },
      ),
      { params: Promise.resolve({ transferGroupId: xfer.transferGroupId }) },
    );
    expect(delXferRes.status).toBe(200);
    await assertZeroRefs(EntityType.TRANSACTION, xfer.outTransaction.id);
    await assertZeroRefs(EntityType.TRANSACTION, xfer.inTransaction.id);

    // 3. Standalone Budget
    const catKeep = await createCategory(userId, {
      name: "Keep Cat",
      type: TransactionType.EXPENSE,
    });
    const standaloneBudget = await upsertBudget(userId, {
      categoryId: catKeep.id,
      year: 2026,
      month: 5,
      amount: "200.0000",
    });
    await attachAllRefs(EntityType.BUDGET, standaloneBudget.id);
    const delBudgetRes = await deleteBudgetRoute(
      makeRequest(
        `http://localhost:3000/api/finances/budgets/${standaloneBudget.id}`,
        { method: "DELETE", cookie: cookieHeader },
      ),
      { params: Promise.resolve({ id: standaloneBudget.id }) },
    );
    expect(delBudgetRes.status).toBe(200);
    await assertZeroRefs(EntityType.BUDGET, standaloneBudget.id);

    // 4. Category with cascaded Budget
    const catDel = await createCategory(userId, {
      name: "Cascade Cat",
      type: TransactionType.EXPENSE,
    });
    const cascadedBudget = await upsertBudget(userId, {
      categoryId: catDel.id,
      year: 2026,
      month: 6,
      amount: "300.0000",
    });
    await attachAllRefs(EntityType.CATEGORY, catDel.id);
    await attachAllRefs(EntityType.BUDGET, cascadedBudget.id);
    const delCatRes = await deleteCategoryRoute(
      makeRequest(
        `http://localhost:3000/api/finances/categories/${catDel.id}`,
        { method: "DELETE", cookie: cookieHeader },
      ),
      { params: Promise.resolve({ id: catDel.id }) },
    );
    expect(delCatRes.status).toBe(200);
    await assertZeroRefs(EntityType.CATEGORY, catDel.id);
    await assertZeroRefs(EntityType.BUDGET, cascadedBudget.id);

    // 5. RecurringRule
    const rule = await createRecurringRule(userId, {
      name: "Delete Rule",
      type: TransactionType.EXPENSE,
      amount: "15.0000",
      accountId: accA.id,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: "2026-01-01T00:00:00.000Z",
    });
    await attachAllRefs(EntityType.RECURRING_RULE, rule.id);
    const delRuleRes = await deleteRecurringRoute(
      makeRequest(
        `http://localhost:3000/api/finances/recurring/${rule.id}`,
        { method: "DELETE", cookie: cookieHeader },
      ),
      { params: Promise.resolve({ id: rule.id }) },
    );
    expect(delRuleRes.status).toBe(200);
    await assertZeroRefs(EntityType.RECURRING_RULE, rule.id);

    // Unrelated anchor tag still exists
    expect(
      await prisma.entityTag.count({
        where: {
          userId,
          entityType: EntityType.FINANCIAL_ACCOUNT,
          entityId: anchorAcc.id,
        },
      }),
    ).toBe(1);
  });

  it("records INBOX_ITEM_UPDATED AuditLog on PATCH /api/inbox/[id]", async () => {
    const account = await createAccount(userId, {
      name: "Main Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    const ingestRes = await ingestInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/ingest", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          externalMessageId: "tier5-patch-audit-1",
          subject: "Card charge",
          bodyText: "Purchase of USD 42.00 at Initial Store",
        },
      }),
    );
    const ingested = await ingestRes.json();
    expect(ingestRes.status).toBe(201);

    const patchRes = await patchInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${ingested.data.id}`, {
        method: "PATCH",
        cookie: cookieHeader,
        body: {
          parsedMerchant: "Updated Merchant",
          suggestedAccountId: account.id,
        },
      }),
      { params: Promise.resolve({ id: ingested.data.id }) },
    );
    expect(patchRes.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: "INBOX_ITEM_UPDATED",
        entityType: "EMAIL_IMPORT_ITEM",
        entityId: ingested.data.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.before).not.toBeNull();
    expect(audit?.after).not.toBeNull();
  });

  it("rejects cross-currency mismatch with 400 VALIDATION_ERROR on transactions, inbox confirm, and recurring rules", async () => {
    const usdAccount = await createAccount(userId, {
      name: "USD Account",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    // 1. POST /api/finances/transactions with EUR on USD account
    const createTxRes = await createTransactionRoute(
      makeRequest("http://localhost:3000/api/finances/transactions", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          accountId: usdAccount.id,
          type: TransactionType.EXPENSE,
          amount: "50.0000",
          currency: "EUR",
          description: "Cross currency tx",
        },
      }),
    );
    expect(createTxRes.status).toBe(400);

    // 2. PATCH /api/finances/transactions/[id] changing currency to EUR on USD account
    const validTx = await createTransaction(userId, {
      accountId: usdAccount.id,
      type: TransactionType.EXPENSE,
      amount: "20.0000",
      description: "Valid USD tx",
    });
    const patchTxRes = await patchTransactionRoute(
      makeRequest(
        `http://localhost:3000/api/finances/transactions/${validTx.id}`,
        {
          method: "PATCH",
          cookie: cookieHeader,
          body: { currency: "EUR" },
        },
      ),
      { params: Promise.resolve({ id: validTx.id }) },
    );
    expect(patchTxRes.status).toBe(400);

    // 3. POST /api/inbox/[id]/confirm for EUR email into USD account
    const eurIngest = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "tier5-eur-email-1",
            subject: "Purchase EUR",
            bodyText: "Card charge EUR 75.00 at Paris Bakery on 2026-11-20",
          },
        }),
      )
    ).json();

    const confirmRes = await confirmInboxItemRoute(
      makeRequest(
        `http://localhost:3000/api/inbox/${eurIngest.data.id}/confirm`,
        {
          method: "POST",
          cookie: cookieHeader,
          body: { accountId: usdAccount.id },
        },
      ),
      { params: Promise.resolve({ id: eurIngest.data.id }) },
    );
    expect(confirmRes.status).toBe(400);

    const stillPending = await prisma.emailImportItem.findUniqueOrThrow({
      where: { id: eurIngest.data.id },
    });
    expect(stillPending.status).toBe("PENDING");

    // 4. Recurring rule create & update currency mismatch
    await expect(
      createRecurringRule(userId, {
        name: "EUR on USD",
        type: TransactionType.EXPENSE,
        amount: "10.0000",
        currency: "EUR",
        accountId: usdAccount.id,
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        startDate: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/currency/i);

    const usdRule = await createRecurringRule(userId, {
      name: "USD Rule",
      type: TransactionType.EXPENSE,
      amount: "10.0000",
      currency: "USD",
      accountId: usdAccount.id,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: "2026-01-01T00:00:00.000Z",
    });

    const patchRuleCurr = await patchRecurringRoute(
      makeRequest(`http://localhost:3000/api/finances/recurring/${usdRule.id}`, {
        method: "PATCH",
        cookie: cookieHeader,
        body: { currency: "EUR" },
      }),
      { params: Promise.resolve({ id: usdRule.id }) },
    );
    expect(patchRuleCurr.status).toBe(400);
  });

  it("rejects PATCH /api/finances/recurring/[id] when endDate < startDate", async () => {
    const account = await createAccount(userId, {
      name: "Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "200.0000",
    });
    const rule = await createRecurringRule(userId, {
      name: "Date Guard Rule",
      type: TransactionType.EXPENSE,
      amount: "10.0000",
      accountId: account.id,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      startDate: "2026-06-01T00:00:00.000Z",
    });

    const res = await patchRecurringRoute(
      makeRequest(`http://localhost:3000/api/finances/recurring/${rule.id}`, {
        method: "PATCH",
        cookie: cookieHeader,
        body: { endDate: "2020-01-01T00:00:00.000Z" },
      }),
      { params: Promise.resolve({ id: rule.id }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects partial, empty, and invalid query params on GET /api/tags and GET /api/entity-links", async () => {
    const invalidTagUrls = [
      "http://localhost:3000/api/tags?entityType=NOT_A_TYPE",
      "http://localhost:3000/api/tags?entityType=TRANSACTION",
      "http://localhost:3000/api/tags?entityId=tx_1",
      "http://localhost:3000/api/tags?entityType=&entityId=",
    ];
    for (const url of invalidTagUrls) {
      const res = await getTagsRoute(
        makeRequest(url, { cookie: cookieHeader }),
      );
      expect(res.status, `Expected 400 for ${url}`).toBe(400);
    }

    const invalidLinkUrls = [
      "http://localhost:3000/api/entity-links?entityType=INVALID",
      "http://localhost:3000/api/entity-links?entityType=TRANSACTION",
      "http://localhost:3000/api/entity-links?entityId=tx_1",
      "http://localhost:3000/api/entity-links?entityType=",
      "http://localhost:3000/api/entity-links?sourceType=",
      "http://localhost:3000/api/entity-links?sourceId=",
    ];
    for (const url of invalidLinkUrls) {
      const res = await getEntityLinksRoute(
        makeRequest(url, { cookie: cookieHeader }),
      );
      expect(res.status, `Expected 400 for ${url}`).toBe(400);
    }
  });

  it("returns 400 INVALID_JSON on malformed non-empty JSON for inbox POST routes while still accepting empty body", async () => {
    const account = await createAccount(userId, {
      name: "Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    const ingestBody = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "tier5-malformed-json-1",
            bodyText: "Card charge USD 20.00 at Coffee Shop",
          },
        }),
      )
    ).json();
    const itemId = ingestBody.data.id as string;

    // 1. /api/inbox/sync malformed JSON -> 400 INVALID_JSON
    const syncRes = await syncInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/sync", {
        method: "POST",
        cookie: cookieHeader,
        rawBody: "{malformed json",
      }),
    );
    expect(syncRes.status).toBe(400);
    expect((await syncRes.json()).error.code).toBe("INVALID_JSON");

    // 2. /api/inbox/[id]/confirm malformed JSON -> 400 INVALID_JSON (no mutation)
    const confirmRes = await confirmInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${itemId}/confirm`, {
        method: "POST",
        cookie: cookieHeader,
        rawBody: "{malformed json",
      }),
      { params: Promise.resolve({ id: itemId }) },
    );
    expect(confirmRes.status).toBe(400);
    expect((await confirmRes.json()).error.code).toBe("INVALID_JSON");

    // 3. /api/inbox/[id]/reject malformed JSON -> 400 INVALID_JSON (no mutation)
    const rejectBadRes = await rejectInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${itemId}/reject`, {
        method: "POST",
        cookie: cookieHeader,
        rawBody: "{malformed json",
      }),
      { params: Promise.resolve({ id: itemId }) },
    );
    expect(rejectBadRes.status).toBe(400);
    expect((await rejectBadRes.json()).error.code).toBe("INVALID_JSON");

    // Verify item is still PENDING and account balance unchanged
    const stillPending = await prisma.emailImportItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(stillPending.status).toBe("PENDING");
    const accAfter = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(formatDecimal(accAfter.balance)).toBe("500.0000");

    // 4. Empty body POST to /api/inbox/[id]/reject still returns 200
    const rejectEmptyRes = await rejectInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${itemId}/reject`, {
        method: "POST",
        cookie: cookieHeader,
      }),
      { params: Promise.resolve({ id: itemId }) },
    );
    expect(rejectEmptyRes.status).toBe(200);
  });
});
