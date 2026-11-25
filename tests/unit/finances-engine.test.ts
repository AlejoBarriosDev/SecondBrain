import { describe, expect, it } from "vitest";
import {
  FinancialAccountType,
  Prisma,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
  TransferDirection,
} from "@prisma/client";
import {
  computeAvailableCredit,
  computeBalanceDelta,
} from "@/modules/finances/serializers";
import { computeBudgetProgress } from "@/modules/finances/budgets";
import {
  computeTransferInAmount,
  createTransferSchema,
} from "@/modules/finances/transfers";
import {
  computeNextRunAt,
  createRecurringRuleSchema,
} from "@/modules/finances/recurring";
import { escapeCsvCell } from "@/modules/finances/export";
import {
  createAccountSchema,
  updateAccountSchema,
} from "@/modules/finances/accounts";
import { upsertBudgetSchema } from "@/modules/finances/budgets";
import {
  exchangeRateStringSchema,
  nonNegativeDecimalStringSchema,
  positiveDecimalStringSchema,
  signedDecimalStringSchema,
} from "@/modules/finances/types";

describe("Finance Accounting Math (Decimal 19,4)", () => {
  it("computes balance deltas for POSTED vs PENDING vs VOID", () => {
    expect(
      computeBalanceDelta(
        TransactionType.INCOME,
        TransactionStatus.POSTED,
        "123.4567",
      ).toFixed(4),
    ).toBe("123.4567");

    expect(
      computeBalanceDelta(
        TransactionType.EXPENSE,
        TransactionStatus.POSTED,
        "45.1000",
      ).toFixed(4),
    ).toBe("-45.1000");

    expect(
      computeBalanceDelta(
        TransactionType.TRANSFER,
        TransactionStatus.POSTED,
        "10.1234",
        TransferDirection.OUT,
      ).toFixed(4),
    ).toBe("-10.1234");

    expect(
      computeBalanceDelta(
        TransactionType.TRANSFER,
        TransactionStatus.POSTED,
        "10.1234",
        TransferDirection.IN,
      ).toFixed(4),
    ).toBe("10.1234");

    // PENDING and VOID never mutate balance
    expect(
      computeBalanceDelta(
        TransactionType.EXPENSE,
        TransactionStatus.PENDING,
        "999.9999",
      ).toFixed(4),
    ).toBe("0.0000");

    expect(
      computeBalanceDelta(
        TransactionType.INCOME,
        TransactionStatus.VOID,
        "999.9999",
      ).toFixed(4),
    ).toBe("0.0000");
  });

  it("computes availableCredit only for CREDIT_CARD with creditLimit", () => {
    expect(
      computeAvailableCredit(
        FinancialAccountType.CREDIT_CARD,
        "-350.2500",
        "2000.0000",
      ),
    ).toBe("1649.7500");

    expect(
      computeAvailableCredit(
        FinancialAccountType.CREDIT_CARD,
        "-350.2500",
        null,
      ),
    ).toBeNull();

    expect(
      computeAvailableCredit(
        FinancialAccountType.BANK,
        "1500.0000",
        "2000.0000",
      ),
    ).toBeNull();
  });

  it("computes budget progress & alert statuses cleanly", () => {
    expect(computeBudgetProgress("500.0000", "200.0000", 80)).toEqual({
      spent: "200.0000",
      remaining: "300.0000",
      percentUsed: 40,
      alertStatus: "OK",
    });

    expect(computeBudgetProgress("500.0000", "400.0000", 80)).toEqual({
      spent: "400.0000",
      remaining: "100.0000",
      percentUsed: 80,
      alertStatus: "WARNING",
    });

    expect(computeBudgetProgress("500.0000", "500.0001", 80)).toEqual({
      spent: "500.0001",
      remaining: "-0.0001",
      percentUsed: 100,
      alertStatus: "EXCEEDED",
    });
  });

  it("computes multi-currency transfer amounts with ROUND_HALF_UP and rejects missing rate", () => {
    const same = computeTransferInAmount(
      new Prisma.Decimal("100.0000"),
      "USD",
      "USD",
    );
    expect(same.inAmount.toFixed(4)).toBe("100.0000");
    expect(same.exchangeRate).toBeNull();

    const byRate = computeTransferInAmount(
      new Prisma.Decimal("100.0000"),
      "USD",
      "EUR",
      { exchangeRate: "0.912345" },
    );
    expect(byRate.inAmount.toFixed(4)).toBe("91.2345");
    expect(byRate.exchangeRate?.toFixed(6)).toBe("0.912345");

    const byToAmount = computeTransferInAmount(
      new Prisma.Decimal("100.0000"),
      "USD",
      "COP",
      { toAmount: "412500.0000" },
    );
    expect(byToAmount.inAmount.toFixed(4)).toBe("412500.0000");
    expect(byToAmount.exchangeRate?.toFixed(4)).toBe("4125.0000");

    expect(() =>
      computeTransferInAmount(new Prisma.Decimal("100.0000"), "USD", "EUR"),
    ).toThrow(/Multi-currency transfer requires/);
  });
});

describe("computeNextRunAt (UTC deterministic recurrence)", () => {
  it("advances DAILY, WEEKLY, BIWEEKLY with interval >= 1", () => {
    const base = new Date("2026-01-15T10:30:00.000Z");

    expect(
      computeNextRunAt(base, RecurrenceFrequency.DAILY, 1).toISOString(),
    ).toBe("2026-01-16T10:30:00.000Z");
    expect(
      computeNextRunAt(base, RecurrenceFrequency.DAILY, 5).toISOString(),
    ).toBe("2026-01-20T10:30:00.000Z");
    expect(
      computeNextRunAt(base, RecurrenceFrequency.WEEKLY, 2).toISOString(),
    ).toBe("2026-01-29T10:30:00.000Z");
    expect(
      computeNextRunAt(base, RecurrenceFrequency.BIWEEKLY, 1).toISOString(),
    ).toBe("2026-01-29T10:30:00.000Z");
  });

  it("clamps month-end dates for MONTHLY and QUARTERLY", () => {
    const jan31NonLeap = new Date("2025-01-31T08:00:00.000Z");
    expect(
      computeNextRunAt(jan31NonLeap, RecurrenceFrequency.MONTHLY, 1).toISOString(),
    ).toBe("2025-02-28T08:00:00.000Z");

    const jan31Leap = new Date("2024-01-31T08:00:00.000Z");
    expect(
      computeNextRunAt(jan31Leap, RecurrenceFrequency.MONTHLY, 1).toISOString(),
    ).toBe("2024-02-29T08:00:00.000Z");

    const mar31 = new Date("2026-03-31T12:00:00.000Z");
    expect(
      computeNextRunAt(mar31, RecurrenceFrequency.MONTHLY, 1).toISOString(),
    ).toBe("2026-04-30T12:00:00.000Z");

    const nov30 = new Date("2025-11-30T09:15:00.000Z");
    expect(
      computeNextRunAt(nov30, RecurrenceFrequency.QUARTERLY, 1).toISOString(),
    ).toBe("2026-02-28T09:15:00.000Z");
  });

  it("clamps Feb 29 for YEARLY recurrence across leap and non-leap years", () => {
    const feb29 = new Date("2024-02-29T00:00:00.000Z");
    expect(
      computeNextRunAt(feb29, RecurrenceFrequency.YEARLY, 1).toISOString(),
    ).toBe("2025-02-28T00:00:00.000Z");
    expect(
      computeNextRunAt(feb29, RecurrenceFrequency.YEARLY, 4).toISOString(),
    ).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("escapeCsvCell (CSV quoting & formula injection neutralization)", () => {
  it("neutralizes leading formula triggers (=, +, -, @, tab, cr)", () => {
    expect(escapeCsvCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(escapeCsvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(escapeCsvCell("-1+1")).toBe("'-1+1");
    expect(escapeCsvCell("@SUM(1,2)")).toBe("\"'@SUM(1,2)\"");
    expect(escapeCsvCell("\t=1+1")).toBe("'\t=1+1");
    expect(escapeCsvCell("  =HYPERLINK(\"http://evil\")")).toBe(
      "\"'  =HYPERLINK(\"\"http://evil\"\")\"",
    );
  });

  it("escapes commas, quotes, and newlines properly", () => {
    expect(escapeCsvCell("Coffee, Tea")).toBe('"Coffee, Tea"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    expect(escapeCsvCell("Plain text")).toBe("Plain text");
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("Finance Zod Schemas", () => {
  it("validates account creation and rejects balance overwrite on update", () => {
    const parsed = createAccountSchema.parse({
      name: "Checking",
      type: FinancialAccountType.BANK,
      currency: "usd",
      balance: "1500.50",
    });
    expect(parsed.currency).toBe("USD");
    expect(parsed.balance).toBe("1500.50");

    expect(() =>
      createAccountSchema.parse({
        name: "Bad Currency",
        type: FinancialAccountType.BANK,
        currency: "US",
      }),
    ).toThrow();

    // updateAccountSchema is strict and forbids untracked balance mutation
    expect(() =>
      updateAccountSchema.parse({
        name: "Checking",
        balance: "99999.0000",
      }),
    ).toThrow();
  });

  it("rejects self-transfer and non-positive transfer amounts", () => {
    expect(() =>
      createTransferSchema.parse({
        fromAccountId: "acc_1",
        toAccountId: "acc_1",
        amount: "10.00",
      }),
    ).toThrow(/must be different/);

    expect(() =>
      createTransferSchema.parse({
        fromAccountId: "acc_1",
        toAccountId: "acc_2",
        amount: "0",
      }),
    ).toThrow();

    expect(() =>
      createTransferSchema.parse({
        fromAccountId: "acc_1",
        toAccountId: "acc_2",
        amount: "-5.00",
      }),
    ).toThrow();
  });

  it("validates budget month/year and recurring transfer constraints", () => {
    expect(() =>
      upsertBudgetSchema.parse({
        categoryId: "cat_1",
        year: 2026,
        month: 13,
        amount: "100.00",
      }),
    ).toThrow();

    expect(() =>
      createRecurringRuleSchema.parse({
        name: "Bad Transfer Rule",
        type: TransactionType.TRANSFER,
        amount: "50.00",
        accountId: "acc_1",
        frequency: RecurrenceFrequency.MONTHLY,
        startDate: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/counterpartyAccountId/);
  });

  it("rejects malformed decimal strings and Decimal(19,4)/Decimal(19,8) overflows cleanly via safeParse without throwing DecimalError", () => {
    const malformedInputs = [
      "",
      "   ",
      "abc",
      "$10",
      "NaN",
      "Infinity",
      "-Infinity",
      "1e5",
      "1e-4",
      "--1",
      "1.2.3",
    ];
    const positiveOnlyInvalid = ["0", "0.0000", "-0.0001"];
    const overflow19_4 = ["9999999999999999.9999", "1000000000000000"];

    for (const input of [
      ...malformedInputs,
      ...positiveOnlyInvalid,
      "0.00001",
      ...overflow19_4,
    ]) {
      let result: ReturnType<typeof positiveDecimalStringSchema.safeParse>;
      expect(() => {
        result = positiveDecimalStringSchema.safeParse(input);
      }).not.toThrow();
      expect(result!.success).toBe(false);
    }

    for (const input of [
      ...malformedInputs,
      "-0.0001",
      "0.00001",
      ...overflow19_4,
    ]) {
      let result: ReturnType<typeof nonNegativeDecimalStringSchema.safeParse>;
      expect(() => {
        result = nonNegativeDecimalStringSchema.safeParse(input);
      }).not.toThrow();
      expect(result!.success).toBe(false);
    }

    for (const input of [
      ...malformedInputs,
      "0.00001",
      ...overflow19_4,
      "-9999999999999999.9999",
    ]) {
      let result: ReturnType<typeof signedDecimalStringSchema.safeParse>;
      expect(() => {
        result = signedDecimalStringSchema.safeParse(input);
      }).not.toThrow();
      expect(result!.success).toBe(false);
    }

    for (const input of [
      ...malformedInputs,
      ...positiveOnlyInvalid,
      ...overflow19_4,
      "999999999999.99999999",
    ]) {
      let result: ReturnType<typeof exchangeRateStringSchema.safeParse>;
      expect(() => {
        result = exchangeRateStringSchema.safeParse(input);
      }).not.toThrow();
      expect(result!.success).toBe(false);
    }

    // Valid @db.Decimal(19,4) boundaries
    expect(positiveDecimalStringSchema.safeParse("0.0001")).toEqual({
      success: true,
      data: "0.0001",
    });
    expect(
      positiveDecimalStringSchema.safeParse("999999999999999.9999"),
    ).toEqual({
      success: true,
      data: "999999999999999.9999",
    });

    expect(nonNegativeDecimalStringSchema.safeParse("0.0000")).toEqual({
      success: true,
      data: "0.0000",
    });
    expect(
      nonNegativeDecimalStringSchema.safeParse("999999999999999.9999"),
    ).toEqual({
      success: true,
      data: "999999999999999.9999",
    });

    expect(signedDecimalStringSchema.safeParse("0.0000")).toEqual({
      success: true,
      data: "0.0000",
    });
    expect(
      signedDecimalStringSchema.safeParse("999999999999999.9999"),
    ).toEqual({
      success: true,
      data: "999999999999999.9999",
    });
    expect(
      signedDecimalStringSchema.safeParse("-999999999999999.9999"),
    ).toEqual({
      success: true,
      data: "-999999999999999.9999",
    });

    // Valid @db.Decimal(19,8) boundaries
    expect(exchangeRateStringSchema.safeParse("0.0001")).toEqual({
      success: true,
      data: "0.0001",
    });
    expect(
      exchangeRateStringSchema.safeParse("99999999999.99999999"),
    ).toEqual({
      success: true,
      data: "99999999999.99999999",
    });
    expect(exchangeRateStringSchema.safeParse("1.23456789")).toEqual({
      success: true,
      data: "1.23456789",
    });
  });
});
