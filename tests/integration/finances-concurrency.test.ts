import { beforeEach, describe, expect, it } from "vitest";
import {
  FinancialAccountType,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDecimals, formatDecimal, subDecimals } from "@/lib/db/decimal";
import { NotFoundError } from "@/lib/api/errors";
import { createAccount } from "@/modules/finances/accounts";
import { createTransfer, deleteTransfer } from "@/modules/finances/transfers";
import {
  createTransaction,
  updateTransaction,
  voidTransaction,
} from "@/modules/finances/transactions";
import {
  createRecurringRule,
  runDueRecurringRules,
} from "@/modules/finances/recurring";
import { resetTestDatabase } from "../helpers/db-reset";
import { getTestAuthHelpers } from "../helpers/test-auth";

describe("Finance Concurrency & Locking Stress Tests (Real Postgres)", () => {
  let userId: string;

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
  });

  it("executes 10 concurrent opposite-direction transfers (5x A->B, 5x B->A) with zero deadlocks and exact Decimal(19,4) balance conservation", async () => {
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
      balance: "500.0000",
    });

    // Interleave 5 A->B (10.1234 each) and 5 B->A (7.5678 each) concurrently
    const jobs = Array.from({ length: 10 }, (_, idx) => {
      if (idx % 2 === 0) {
        return createTransfer(userId, {
          fromAccountId: accA.id,
          toAccountId: accB.id,
          amount: "10.1234",
          description: `Transfer A->B #${idx}`,
        });
      }
      return createTransfer(userId, {
        fromAccountId: accB.id,
        toAccountId: accA.id,
        amount: "7.5678",
        description: `Transfer B->A #${idx}`,
      });
    });

    const results = await Promise.all(jobs);
    expect(results).toHaveLength(10);

    const [finalA, finalB] = await Promise.all([
      prisma.financialAccount.findUniqueOrThrow({ where: { id: accA.id } }),
      prisma.financialAccount.findUniqueOrThrow({ where: { id: accB.id } }),
    ]);

    // Exact math:
    // 5 * 10.1234 = 50.6170
    // 5 * 7.5678  = 37.8390
    // Net A->B    = 12.7780
    // A = 1000.0000 - 12.7780 = 987.2220
    // B =  500.0000 + 12.7780 = 512.7780
    // Conservation: A + B = 1500.0000
    expect(formatDecimal(finalA.balance)).toBe("987.2220");
    expect(formatDecimal(finalB.balance)).toBe("512.7780");
    expect(formatDecimal(addDecimals(finalA.balance, finalB.balance))).toBe(
      "1500.0000",
    );

    const txCount = await prisma.transaction.count({
      where: { userId, type: TransactionType.TRANSFER },
    });
    expect(txCount).toBe(20);
  });

  it("guarantees strict idempotency when 5 concurrent recurring runners fire simultaneously", async () => {
    const acc = await createAccount(userId, {
      name: "Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    const rule = await createRecurringRule(userId, {
      name: "Netflix",
      type: TransactionType.EXPENSE,
      amount: "19.9900",
      accountId: acc.id,
      frequency: RecurrenceFrequency.MONTHLY,
      startDate: "2026-03-01T00:00:00.000Z",
      autoPost: true,
    });

    const runAt = new Date("2026-03-02T00:00:00.000Z");
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        runDueRecurringRules({ userId, now: runAt }),
      ),
    );

    const totalProcessed = runs.reduce((accSum, r) => accSum + r.processedCount, 0);
    expect(totalProcessed).toBe(1);

    const txCount = await prisma.transaction.count({
      where: { userId, recurringRuleId: rule.id },
    });
    expect(txCount).toBe(1);

    const finalAcc = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: acc.id },
    });
    expect(formatDecimal(finalAcc.balance)).toBe("480.0100");
  });

  it("prevents double balance reversal when 5 concurrent deleteTransfer calls target the same transfer", async () => {
    const accA = await createAccount(userId, {
      name: "Checking A",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });

    const accB = await createAccount(userId, {
      name: "Savings B",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    const transfer = await createTransfer(userId, {
      fromAccountId: accA.id,
      toAccountId: accB.id,
      amount: "100.0000",
      description: "Concurrent delete test",
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        deleteTransfer(userId, transfer.transferGroupId),
      ),
    );

    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(NotFoundError);
    }

    const [finalA, finalB] = await Promise.all([
      prisma.financialAccount.findUniqueOrThrow({ where: { id: accA.id } }),
      prisma.financialAccount.findUniqueOrThrow({ where: { id: accB.id } }),
    ]);

    expect(formatDecimal(finalA.balance)).toBe("1000.0000");
    expect(formatDecimal(finalB.balance)).toBe("500.0000");

    const remainingLegs = await prisma.transaction.count({
      where: { userId, transferGroupId: transfer.transferGroupId },
    });
    expect(remainingLegs).toBe(0);
  });

  it("prevents double balance reversal when 5 concurrent voidTransaction calls target the same POSTED EXPENSE", async () => {
    const acc = await createAccount(userId, {
      name: "Void Test Bank",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });

    const tx = await createTransaction(userId, {
      accountId: acc.id,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.POSTED,
      amount: "100.0000",
      description: "Expense to void concurrently",
    });

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => voidTransaction(userId, tx.id)),
    );

    expect(outcomes).toHaveLength(5);
    for (const res of outcomes) {
      expect(res.status).toBe(TransactionStatus.VOID);
    }

    const finalAcc = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: acc.id },
    });
    expect(formatDecimal(finalAcc.balance)).toBe("1000.0000");
  });

  it("prevents balance drift when 5 concurrent updateTransaction calls edit the amount of the same POSTED EXPENSE", async () => {
    const acc = await createAccount(userId, {
      name: "Update Test Bank",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });

    const tx = await createTransaction(userId, {
      accountId: acc.id,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.POSTED,
      amount: "50.0000",
      description: "Expense to update concurrently",
    });

    const amounts = ["60.0000", "70.0000", "80.0000", "90.0000", "120.0000"];
    const results = await Promise.all(
      amounts.map((amount) => updateTransaction(userId, tx.id, { amount })),
    );
    expect(results).toHaveLength(5);

    const [finalAcc, finalTx] = await Promise.all([
      prisma.financialAccount.findUniqueOrThrow({ where: { id: acc.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
    ]);

    const expectedBalance = subDecimals("1000.0000", finalTx.amount);
    expect(formatDecimal(finalAcc.balance)).toBe(formatDecimal(expectedBalance));
  });
});
