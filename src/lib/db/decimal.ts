import { Prisma } from "@prisma/client";
import { ValidationError } from "@/lib/api/errors";

export const DECIMAL_REGEX = /^\d+(\.\d{1,4})?$/;
export const SIGNED_DECIMAL_REGEX = /^-?\d+(\.\d{1,4})?$/;

export type DecimalInput = string | Prisma.Decimal;

export function toDecimal(value: DecimalInput): Prisma.Decimal {
  if (Prisma.Decimal.isDecimal(value)) {
    if (!value.isFinite()) {
      throw new ValidationError("Monetary value must be finite");
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new ValidationError("Monetary value must be a decimal string");
  }

  const trimmed = value.trim();
  if (!SIGNED_DECIMAL_REGEX.test(trimmed)) {
    throw new ValidationError(
      `Invalid decimal value "${value}". Expected format matching /^-?\\d+(\\.\\d{1,4})?$/`,
    );
  }

  const decimal = new Prisma.Decimal(trimmed);
  if (!decimal.isFinite()) {
    throw new ValidationError("Monetary value must be finite");
  }
  return decimal;
}

export function toPositiveDecimal(value: DecimalInput): Prisma.Decimal {
  const decimal = toDecimal(value);
  if (decimal.lte(0)) {
    throw new ValidationError("Monetary amount must be greater than zero");
  }
  return decimal;
}

export function toNonNegativeDecimal(value: DecimalInput): Prisma.Decimal {
  const decimal = toDecimal(value);
  if (decimal.lt(0)) {
    throw new ValidationError("Monetary amount cannot be negative");
  }
  return decimal;
}

export function formatDecimal(value: DecimalInput, scale = 4): string {
  const decimal = Prisma.Decimal.isDecimal(value)
    ? value
    : new Prisma.Decimal(value);
  return decimal.toFixed(scale);
}

export function addDecimals(
  a: DecimalInput,
  b: DecimalInput,
): Prisma.Decimal {
  return toDecimal(a).plus(toDecimal(b));
}

export function subDecimals(
  a: DecimalInput,
  b: DecimalInput,
): Prisma.Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

export function sumDecimals(values: readonly DecimalInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, val) => acc.plus(toDecimal(val)),
    new Prisma.Decimal(0),
  );
}
