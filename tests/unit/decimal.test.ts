import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  addDecimals,
  formatDecimal,
  subDecimals,
  sumDecimals,
  toDecimal,
  toNonNegativeDecimal,
  toPositiveDecimal,
} from "@/lib/db/decimal";
import { ValidationError } from "@/lib/api/errors";

describe("Decimal monetary helpers", () => {
  it("performs exact decimal arithmetic without floating-point drift", () => {
    const sum = addDecimals("0.1", "0.2");
    expect(formatDecimal(sum)).toBe("0.3000");

    const diff = subDecimals("100.0000", "33.3333");
    expect(formatDecimal(diff)).toBe("66.6667");

    const total = sumDecimals(["19.99", "0.01", "-5.5005", new Prisma.Decimal("10.5005")]);
    expect(formatDecimal(total)).toBe("25.0000");
  });

  it("accepts signed decimal strings up to 4 decimal places", () => {
    expect(formatDecimal(toDecimal("-1250.4567"))).toBe("-1250.4567");
    expect(formatDecimal(toDecimal("0"))).toBe("0.0000");
    expect(formatDecimal(toDecimal("42.5"))).toBe("42.5000");
  });

  it("rejects malformed strings, NaN, Infinity, and >4 decimal places", () => {
    expect(() => toDecimal("")).toThrow(ValidationError);
    expect(() => toDecimal("abc")).toThrow(ValidationError);
    expect(() => toDecimal("NaN")).toThrow(ValidationError);
    expect(() => toDecimal("Infinity")).toThrow(ValidationError);
    expect(() => toDecimal("12.12345")).toThrow(ValidationError);
    expect(() => toDecimal("1e5")).toThrow(ValidationError);
    expect(() => toDecimal(new Prisma.Decimal(NaN))).toThrow(ValidationError);
    expect(() => toDecimal(new Prisma.Decimal(Infinity))).toThrow(ValidationError);
  });

  it("enforces positive and non-negative guards", () => {
    expect(formatDecimal(toPositiveDecimal("0.0001"))).toBe("0.0001");
    expect(() => toPositiveDecimal("0")).toThrow(ValidationError);
    expect(() => toPositiveDecimal("-1.00")).toThrow(ValidationError);

    expect(formatDecimal(toNonNegativeDecimal("0"))).toBe("0.0000");
    expect(() => toNonNegativeDecimal("-0.0001")).toThrow(ValidationError);
  });
});
