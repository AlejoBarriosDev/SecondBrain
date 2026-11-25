import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  EmailImportStatus,
  FinancialAccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resetTestDatabase } from "../helpers/db-reset";
import { getTestAuthHelpers } from "../helpers/test-auth";

import {
  GET as listAccountsRoute,
  POST as createAccountRoute,
} from "@/app/api/finances/accounts/route";
import {
  GET as getAccountRoute,
  PATCH as patchAccountRoute,
  DELETE as deleteAccountRoute,
} from "@/app/api/finances/accounts/[id]/route";
import {
  GET as listCategoriesRoute,
  POST as createCategoryRoute,
} from "@/app/api/finances/categories/route";
import {
  PATCH as patchCategoryRoute,
  DELETE as deleteCategoryRoute,
} from "@/app/api/finances/categories/[id]/route";
import {
  GET as listBudgetsRoute,
  POST as upsertBudgetRoute,
} from "@/app/api/finances/budgets/route";
import { DELETE as deleteBudgetRoute } from "@/app/api/finances/budgets/[id]/route";
import {
  GET as listTransactionsRoute,
  POST as createTransactionRoute,
} from "@/app/api/finances/transactions/route";
import {
  GET as getTransactionRoute,
  PATCH as patchTransactionRoute,
  DELETE as deleteTransactionRoute,
} from "@/app/api/finances/transactions/[id]/route";
import {
  GET as listTransfersRoute,
  POST as createTransferRoute,
} from "@/app/api/finances/transfers/route";
import { DELETE as deleteTransferRoute } from "@/app/api/finances/transfers/[transferGroupId]/route";
import { GET as exportTransactionsRoute } from "@/app/api/finances/export/route";
import {
  GET as listRecurringRoute,
  POST as createRecurringRoute,
} from "@/app/api/finances/recurring/route";
import {
  PATCH as patchRecurringRoute,
  DELETE as deleteRecurringRoute,
} from "@/app/api/finances/recurring/[id]/route";
import { POST as runRecurringRoute } from "@/app/api/finances/recurring/run/route";
import { GET as dashboardRoute } from "@/app/api/finances/dashboard/route";
import { voidTransaction } from "@/modules/finances/transactions";

describe("Finance Engine & Ledger API (Real Postgres Integration)", () => {
  let userId: string;
  let authHeaders: Headers;

  function makeRequest(
    path: string,
    init?: {
      method?: string;
      body?: unknown;
      authenticated?: boolean;
      extraHeaders?: Record<string, string>;
    },
  ): NextRequest {
    const headers =
      init?.authenticated === false ? new Headers() : new Headers(authHeaders);
    if (init?.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (init?.extraHeaders) {
      for (const [k, v] of Object.entries(init.extraHeaders)) {
        headers.set(k, v);
      }
    }
    return new NextRequest(`http://localhost:3000${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.ALLOWED_EMAIL = "owner@secondbrain.local";

    const tu = await getTestAuthHelpers();
    const saved = await tu.saveUser(
      tu.createUser({
        email: "owner@secondbrain.local",
        name: "Owner",
      }),
    );
    userId = saved.id;
    authHeaders = await tu.getAuthHeaders({ userId });
  });

  it("handles Financial Accounts CRUD, credit card availableCredit, archive, and audit logs", async () => {
    const createRes = await createAccountRoute(
      makeRequest("/api/finances/accounts", {
        method: "POST",
        body: {
          name: "Visa Sapphire",
          type: FinancialAccountType.CREDIT_CARD,
          currency: "usd",
          balance: "-250.5000",
          creditLimit: "3000.0000",
          closingDay: 15,
          dueDay: 5,
          institution: "Chase",
          lastFour: "4242",
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data;
    expect(created.currency).toBe("USD");
    expect(created.balance).toBe("-250.5000");
    expect(created.creditLimit).toBe("3000.0000");
    expect(created.availableCredit).toBe("2749.5000");
    expect(created.statementClosingDay).toBe(15);
    expect(created.paymentDueDay).toBe(5);

    // Reject untracked balance overwrite on PATCH
    const badPatch = await patchAccountRoute(
      makeRequest(`/api/finances/accounts/${created.id}`, {
        method: "PATCH",
        body: { balance: "9999.0000" },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(badPatch.status).toBe(400);

    // Valid PATCH
    const goodPatch = await patchAccountRoute(
      makeRequest(`/api/finances/accounts/${created.id}`, {
        method: "PATCH",
        body: { name: "Visa Reserve", creditLimit: "5000.0000" },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(goodPatch.status).toBe(200);
    const updated = (await goodPatch.json()).data;
    expect(updated.name).toBe("Visa Reserve");
    expect(updated.availableCredit).toBe("4749.5000");

    // Archive via DELETE
    const delRes = await deleteAccountRoute(
      makeRequest(`/api/finances/accounts/${created.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).data.isArchived).toBe(true);

    // Excluded by default, included when includeArchived=true
    const activeList = await (
      await listAccountsRoute(makeRequest("/api/finances/accounts"))
    ).json();
    expect(activeList.data).toHaveLength(0);

    const allList = await (
      await listAccountsRoute(
        makeRequest("/api/finances/accounts?includeArchived=true"),
      )
    ).json();
    expect(allList.data).toHaveLength(1);

    // Reject creating transaction on archived account
    const txOnArchived = await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: created.id,
          type: TransactionType.EXPENSE,
          amount: "10.00",
          description: "Should fail",
        },
      }),
    );
    expect(txOnArchived.status).toBe(400);

    const auditCount = await prisma.auditLog.count({
      where: { userId, entityId: created.id },
    });
    expect(auditCount).toBe(3); // CREATED, UPDATED, ARCHIVED
  });

  it("handles hierarchical Categories CRUD and prevents cycles", async () => {
    const resA = await createCategoryRoute(
      makeRequest("/api/finances/categories", {
        method: "POST",
        body: { name: "Cat A", type: TransactionType.EXPENSE },
      }),
    );
    expect(resA.status).toBe(201);
    const catA = (await resA.json()).data;

    const resB = await createCategoryRoute(
      makeRequest("/api/finances/categories", {
        method: "POST",
        body: {
          name: "Cat B",
          type: TransactionType.EXPENSE,
          parentId: catA.id,
        },
      }),
    );
    expect(resB.status).toBe(201);
    const catB = (await resB.json()).data;

    const resC = await createCategoryRoute(
      makeRequest("/api/finances/categories", {
        method: "POST",
        body: {
          name: "Cat C",
          type: TransactionType.EXPENSE,
          parentId: catB.id,
        },
      }),
    );
    expect(resC.status).toBe(201);
    const catC = (await resC.json()).data;

    // Self-parent rejected
    const selfRes = await patchCategoryRoute(
      makeRequest(`/api/finances/categories/${catA.id}`, {
        method: "PATCH",
        body: { parentId: catA.id },
      }),
      { params: Promise.resolve({ id: catA.id }) },
    );
    expect(selfRes.status).toBe(400);

    // 3-node cycle A -> C -> B -> A rejected
    const cycleRes = await patchCategoryRoute(
      makeRequest(`/api/finances/categories/${catA.id}`, {
        method: "PATCH",
        body: { parentId: catC.id },
      }),
      { params: Promise.resolve({ id: catA.id }) },
    );
    expect(cycleRes.status).toBe(400);

    // Filter list by type
    const expenseCats = await (
      await listCategoriesRoute(
        makeRequest("/api/finances/categories?type=EXPENSE"),
      )
    ).json();
    expect(
      expenseCats.data.every(
        (c: { type: string }) => c.type === TransactionType.EXPENSE,
      ),
    ).toBe(true);

    // Delete catC
    const delC = await deleteCategoryRoute(
      makeRequest(`/api/finances/categories/${catC.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: catC.id }) },
    );
    expect(delC.status).toBe(200);
  });

  it("handles Transactions lifecycle (create, tags, move account, void, delete, filters, CSV/JSON export)", async () => {
    const acc1 = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "Checking",
              type: FinancialAccountType.BANK,
              currency: "USD",
              balance: "1000.0000",
            },
          }),
        )
      ).json()
    ).data;

    const acc2 = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "Cash Wallet",
              type: FinancialAccountType.CASH,
              currency: "USD",
              balance: "200.0000",
            },
          }),
        )
      ).json()
    ).data;

    const tag = await prisma.tag.create({
      data: { userId, name: "Work", color: "#22c55e" },
    });

    // Reject direct TRANSFER creation on /transactions
    const badTx = await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: acc1.id,
          type: TransactionType.TRANSFER,
          amount: "50.00",
          description: "Invalid direct transfer",
        },
      }),
    );
    expect(badTx.status).toBe(400);

    // Create EXPENSE with formula-injection payload in description + tag
    const txRes = await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: acc1.id,
          type: TransactionType.EXPENSE,
          amount: "125.5000",
          description: "=SUM(A1:A5) Lunch",
          merchant: "Cafe",
          occurredAt: "2026-05-10T12:00:00.000Z",
          tagIds: [tag.id],
        },
      }),
    );
    expect(txRes.status).toBe(201);
    const tx = (await txRes.json()).data;
    expect(tx.amount).toBe("125.5000");
    expect(tx.tags).toHaveLength(1);

    // Verify balance updated on acc1: 1000 - 125.5 = 874.5
    let acc1Row = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: acc1.id },
    });
    expect(acc1Row.balance.toFixed(4)).toBe("874.5000");

    // Move transaction to acc2 & change amount to 50.0000
    const patchRes = await patchTransactionRoute(
      makeRequest(`/api/finances/transactions/${tx.id}`, {
        method: "PATCH",
        body: {
          accountId: acc2.id,
          amount: "50.0000",
        },
      }),
      { params: Promise.resolve({ id: tx.id }) },
    );
    expect(patchRes.status).toBe(200);

    acc1Row = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: acc1.id },
    });
    let acc2Row = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: acc2.id },
    });
    expect(acc1Row.balance.toFixed(4)).toBe("1000.0000");
    expect(acc2Row.balance.toFixed(4)).toBe("150.0000");

    // Filter by tagId and q
    const filteredRes = await listTransactionsRoute(
      makeRequest(`/api/finances/transactions?tagId=${tag.id}&q=cafe`),
    );
    const filteredBody = await filteredRes.json();
    expect(filteredBody.data).toHaveLength(1);
    expect(filteredBody.meta.total).toBe(1);

    // Export CSV — must neutralize =SUM(A1:A5)
    const csvRes = await exportTransactionsRoute(
      makeRequest("/api/finances/export?format=csv"),
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csvText = await csvRes.text();
    expect(csvText).toContain("'=SUM(A1:A5) Lunch");

    // Export JSON
    const jsonRes = await exportTransactionsRoute(
      makeRequest("/api/finances/export?format=json"),
    );
    expect(jsonRes.status).toBe(200);
    const jsonExport = JSON.parse(await jsonRes.text());
    expect(jsonExport.count).toBe(1);

    // Void transaction -> reverses acc2 balance back to 200.0000
    await voidTransaction(userId, tx.id);
    acc2Row = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: acc2.id },
    });
    expect(acc2Row.balance.toFixed(4)).toBe("200.0000");

    // Delete transaction -> cleans up EntityTag rows
    const delRes = await deleteTransactionRoute(
      makeRequest(`/api/finances/transactions/${tx.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: tx.id }) },
    );
    expect(delRes.status).toBe(200);
    const remainingTags = await prisma.entityTag.count({
      where: { entityId: tx.id },
    });
    expect(remainingTags).toBe(0);
  });

  it("computes Monthly Budgets excluding transfers, income, and non-posted transactions", async () => {
    const acc1 = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "Main Bank",
              type: FinancialAccountType.BANK,
              currency: "USD",
              balance: "5000.0000",
            },
          }),
        )
      ).json()
    ).data;

    const acc2 = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "Savings",
              type: FinancialAccountType.BANK,
              currency: "USD",
              balance: "1000.0000",
            },
          }),
        )
      ).json()
    ).data;

    const foodCat = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Food & Dining" },
    });

    const budgetRes = await upsertBudgetRoute(
      makeRequest("/api/finances/budgets", {
        method: "POST",
        body: {
          categoryId: foodCat.id,
          year: 2026,
          month: 6,
          limitAmount: "500.0000",
          alertThresholdPct: 80,
        },
      }),
    );
    expect(budgetRes.status).toBe(201);
    const budget = (await budgetRes.json()).data;

    // 1) Posted EXPENSE of 420.0000 -> WARNING (84%)
    await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: acc1.id,
          categoryId: foodCat.id,
          type: TransactionType.EXPENSE,
          amount: "420.0000",
          description: "Groceries",
          occurredAt: "2026-06-15T10:00:00.000Z",
        },
      }),
    );

    // 2) PENDING EXPENSE of 200.0000 -> MUST NOT count
    await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: acc1.id,
          categoryId: foodCat.id,
          type: TransactionType.EXPENSE,
          status: TransactionStatus.PENDING,
          amount: "200.0000",
          description: "Pending dinner",
          occurredAt: "2026-06-16T10:00:00.000Z",
        },
      }),
    );

    // 3) TRANSFER with same categoryId of 300.0000 -> MUST NOT count
    await createTransferRoute(
      makeRequest("/api/finances/transfers", {
        method: "POST",
        body: {
          fromAccountId: acc1.id,
          toAccountId: acc2.id,
          categoryId: foodCat.id,
          amount: "300.0000",
          occurredAt: "2026-06-17T10:00:00.000Z",
        },
      }),
    );

    const listRes = await listBudgetsRoute(
      makeRequest("/api/finances/budgets?year=2026&month=6"),
    );
    const budgets = (await listRes.json()).data;
    expect(budgets).toHaveLength(1);
    expect(budgets[0].spent).toBe("420.0000");
    expect(budgets[0].remaining).toBe("80.0000");
    expect(budgets[0].percentUsed).toBe(84);
    expect(budgets[0].alertStatus).toBe("WARNING");

    // Add 100.0000 more -> EXCEEDED (520 / 500 = 104%)
    await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: acc1.id,
          categoryId: foodCat.id,
          type: TransactionType.EXPENSE,
          amount: "100.0000",
          description: "Restaurant",
          occurredAt: "2026-06-20T10:00:00.000Z",
        },
      }),
    );

    const listRes2 = await listBudgetsRoute(
      makeRequest("/api/finances/budgets?year=2026&month=6"),
    );
    const budgets2 = (await listRes2.json()).data;
    expect(budgets2[0].spent).toBe("520.0000");
    expect(budgets2[0].remaining).toBe("-20.0000");
    expect(budgets2[0].alertStatus).toBe("EXCEEDED");

    // Delete budget
    const delBudget = await deleteBudgetRoute(
      makeRequest(`/api/finances/budgets/${budget.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: budget.id }) },
    );
    expect(delBudget.status).toBe(200);
  });

  it("runs Recurring Rules idempotently, respects autoPost:false, supports CRON_SECRET, and aggregates Dashboard", async () => {
    const bank = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "Primary Bank",
              type: FinancialAccountType.BANK,
              currency: "USD",
              balance: "1000.0000",
            },
          }),
        )
      ).json()
    ).data;

    const card = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "Credit Card",
              type: FinancialAccountType.CREDIT_CARD,
              currency: "USD",
              balance: "-200.0000",
              creditLimit: "2000.0000",
            },
          }),
        )
      ).json()
    ).data;

    // 1) autoPost: true due rule
    const ruleAuto = (
      await (
        await createRecurringRoute(
          makeRequest("/api/finances/recurring", {
            method: "POST",
            body: {
              name: "Cloud Server",
              type: TransactionType.EXPENSE,
              amount: "25.0000",
              accountId: bank.id,
              frequency: RecurrenceFrequency.MONTHLY,
              startDate: "2026-01-31T00:00:00.000Z",
              autoPost: true,
            },
          }),
        )
      ).json()
    ).data;

    // 2) autoPost: false due rule
    const rulePending = (
      await (
        await createRecurringRoute(
          makeRequest("/api/finances/recurring", {
            method: "POST",
            body: {
              name: "Manual Review Sub",
              type: TransactionType.EXPENSE,
              amount: "15.0000",
              accountId: bank.id,
              frequency: RecurrenceFrequency.MONTHLY,
              startDate: "2026-01-31T00:00:00.000Z",
              autoPost: false,
            },
          }),
        )
      ).json()
    ).data;

    // Update rule name via PATCH
    const patchedRule = await patchRecurringRoute(
      makeRequest(`/api/finances/recurring/${rulePending.id}`, {
        method: "PATCH",
        body: { name: "Manual Review Sub Updated" },
      }),
      { params: Promise.resolve({ id: rulePending.id }) },
    );
    expect(patchedRule.status).toBe(200);

    // List recurring rules
    const listRules = await (
      await listRecurringRoute(makeRequest("/api/finances/recurring"))
    ).json();
    expect(listRules.data).toHaveLength(2);

    // Invalid CRON_SECRET bearer token -> 401
    process.env.CRON_SECRET = "super-secret-cron-token";
    const badCronRes = await runRecurringRoute(
      makeRequest("/api/finances/recurring/run", {
        method: "POST",
        authenticated: false,
        extraHeaders: { authorization: "Bearer wrong-token" },
        body: { now: "2026-02-01T00:00:00.000Z" },
      }),
    );
    expect(badCronRes.status).toBe(401);

    // Valid CRON_SECRET bearer token -> processes both rules once
    const run1Res = await runRecurringRoute(
      makeRequest("/api/finances/recurring/run", {
        method: "POST",
        authenticated: false,
        extraHeaders: { authorization: "Bearer super-secret-cron-token" },
        body: { now: "2026-02-01T00:00:00.000Z" },
      }),
    );
    expect(run1Res.status).toBe(200);
    const run1Data = (await run1Res.json()).data;
    expect(run1Data.processedCount).toBe(2);

    // Second run with same `now` -> idempotent (0 processed!)
    const run2Res = await runRecurringRoute(
      makeRequest("/api/finances/recurring/run", {
        method: "POST",
        body: { now: "2026-02-01T00:00:00.000Z" },
      }),
    );
    expect(run2Res.status).toBe(200);
    expect((await run2Res.json()).data.processedCount).toBe(0);

    // Bank balance should only reflect autoPost:true (-25.0000), NOT autoPost:false (-15.0000)
    const bankAfter = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: bank.id },
    });
    expect(bankAfter.balance.toFixed(4)).toBe("975.0000");

    // Verify nextRunAt clamped from Jan 31 -> Feb 28 (2026 is non-leap)
    const ruleAutoAfter = await prisma.recurringRule.findUniqueOrThrow({
      where: { id: ruleAuto.id },
    });
    expect(ruleAutoAfter.nextRunAt.toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );

    // Seed 1 pending inbox item & transfer (transfer should not count in cashflow)
    await prisma.emailImportItem.create({
      data: {
        userId,
        externalMessageId: "msg-001",
        receivedAt: new Date("2026-01-31T12:00:00.000Z"),
        status: EmailImportStatus.PENDING,
      },
    });

    const transferRes = await createTransferRoute(
      makeRequest("/api/finances/transfers", {
        method: "POST",
        body: {
          fromAccountId: bank.id,
          toAccountId: card.id,
          amount: "100.0000",
          occurredAt: "2026-01-31T12:00:00.000Z",
        },
      }),
    );
    expect(transferRes.status).toBe(201);
    const transfer = (await transferRes.json()).data;

    const listTransfersRes = await listTransfersRoute(
      makeRequest("/api/finances/transfers"),
    );
    expect((await listTransfersRes.json()).data).toHaveLength(1);

    // Dashboard for 2026-01
    const dashRes = await dashboardRoute(
      makeRequest("/api/finances/dashboard?year=2026&month=1"),
    );
    expect(dashRes.status).toBe(200);
    const dash = (await dashRes.json()).data;
    expect(dash.pendingInboxCount).toBe(1);
    // Net worth: bank (875) + card (-100) = 775.0000
    expect(dash.netWorth).toBe("775.0000");
    expect(dash.netWorthByCurrency).toEqual([
      {
        currency: "USD",
        totalBalance: "775.0000",
        assets: "875.0000",
        liabilities: "-100.0000",
      },
    ]);
    // Cashflow for Jan 2026: only the POSTED expense 25.0000 (transfer & pending excluded)
    expect(dash.monthlyCashflow.byCurrency).toEqual([
      {
        currency: "USD",
        income: "0.0000",
        expense: "25.0000",
        net: "-25.0000",
      },
    ]);

    // Delete transfer reverses balances cleanly
    const delTransferRes = await deleteTransferRoute(
      makeRequest(`/api/finances/transfers/${transfer.transferGroupId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ transferGroupId: transfer.transferGroupId }) },
    );
    expect(delTransferRes.status).toBe(200);

    // Delete recurring rule
    const delRuleRes = await deleteRecurringRoute(
      makeRequest(`/api/finances/recurring/${rulePending.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: rulePending.id }) },
    );
    expect(delRuleRes.status).toBe(200);
  });

  it("enforces 401 unauthenticated and 404 cross-user tenant isolation across finance endpoints", async () => {
    // Unauthenticated requests -> 401
    expect(
      (
        await listAccountsRoute(
          makeRequest("/api/finances/accounts", { authenticated: false }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await dashboardRoute(
          makeRequest("/api/finances/dashboard", { authenticated: false }),
        )
      ).status,
    ).toBe(401);

    // Create another user with their own records
    const otherUser = await prisma.user.create({
      data: {
        email: "other@secondbrain.local",
        name: "Other User",
      },
    });

    const otherAcc = await prisma.financialAccount.create({
      data: {
        userId: otherUser.id,
        name: "Other Bank",
        type: FinancialAccountType.BANK,
        currency: "USD",
        balance: "500.0000",
      },
    });

    const otherTx = await prisma.transaction.create({
      data: {
        userId: otherUser.id,
        accountId: otherAcc.id,
        type: TransactionType.EXPENSE,
        amount: "10.0000",
        currency: "USD",
        occurredAt: new Date(),
        description: "Secret expense",
      },
    });

    // Authenticated owner trying to access otherUser's account & transaction -> 404
    const accRes = await getAccountRoute(
      makeRequest(`/api/finances/accounts/${otherAcc.id}`),
      { params: Promise.resolve({ id: otherAcc.id }) },
    );
    expect(accRes.status).toBe(404);

    const txRes = await getTransactionRoute(
      makeRequest(`/api/finances/transactions/${otherTx.id}`),
      { params: Promise.resolve({ id: otherTx.id }) },
    );
    expect(txRes.status).toBe(404);
  });

  it("isolates multi-currency expenses so EUR expenses do not inflate a USD budget in the same category", async () => {
    const usdAcc = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "USD Checking",
              type: FinancialAccountType.BANK,
              currency: "USD",
              balance: "2000.0000",
            },
          }),
        )
      ).json()
    ).data;

    const eurAcc = (
      await (
        await createAccountRoute(
          makeRequest("/api/finances/accounts", {
            method: "POST",
            body: {
              name: "EUR Checking",
              type: FinancialAccountType.BANK,
              currency: "EUR",
              balance: "2000.0000",
            },
          }),
        )
      ).json()
    ).data;

    const foodCat = await prisma.category.findFirstOrThrow({
      where: { userId, name: "Food & Dining" },
    });

    const budgetRes = await upsertBudgetRoute(
      makeRequest("/api/finances/budgets", {
        method: "POST",
        body: {
          categoryId: foodCat.id,
          year: 2026,
          month: 7,
          limitAmount: "500.0000",
          currency: "USD",
          alertThresholdPct: 80,
        },
      }),
    );
    expect(budgetRes.status).toBe(201);

    // USD expense of 150.0000 -> MUST count toward USD budget
    await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: usdAcc.id,
          categoryId: foodCat.id,
          type: TransactionType.EXPENSE,
          amount: "150.0000",
          description: "US Groceries",
          occurredAt: "2026-07-10T10:00:00.000Z",
        },
      }),
    );

    // EUR expense of 400.0000 in the same category -> MUST NOT inflate USD budget
    await createTransactionRoute(
      makeRequest("/api/finances/transactions", {
        method: "POST",
        body: {
          accountId: eurAcc.id,
          categoryId: foodCat.id,
          type: TransactionType.EXPENSE,
          amount: "400.0000",
          description: "Madrid Dinner",
          occurredAt: "2026-07-11T10:00:00.000Z",
        },
      }),
    );

    const listRes = await listBudgetsRoute(
      makeRequest("/api/finances/budgets?year=2026&month=7"),
    );
    expect(listRes.status).toBe(200);
    const budgets = (await listRes.json()).data;
    expect(budgets).toHaveLength(1);
    expect(budgets[0].currency).toBe("USD");
    expect(budgets[0].spent).toBe("150.0000");
    expect(budgets[0].remaining).toBe("350.0000");
    expect(budgets[0].alertStatus).toBe("OK");
  });

  it("returns 401 (not 400) for unauthenticated malformed JSON on POST /api/finances/recurring/run", async () => {
    const malformedReq = new NextRequest(
      "http://localhost:3000/api/finances/recurring/run",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-valid-json",
      },
    );

    const res = await runRecurringRoute(malformedReq);
    expect(res.status).toBe(401);
  });
});
