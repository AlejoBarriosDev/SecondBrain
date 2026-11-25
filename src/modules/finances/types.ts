import { Prisma } from "@prisma/client";
import { z } from "zod";
import { DECIMAL_REGEX, SIGNED_DECIMAL_REGEX } from "@/lib/db/decimal";

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code");

const EXCHANGE_RATE_REGEX = /^\d+(\.\d{1,8})?$/;
const MAX_DECIMAL_19_4 = new Prisma.Decimal("999999999999999.9999");
const MAX_EXCHANGE_RATE = new Prisma.Decimal("99999999999.99999999");

export const positiveDecimalStringSchema = z
  .string()
  .trim()
  .regex(DECIMAL_REGEX, "Must be a positive decimal with up to 4 decimal places")
  .refine(
    (val) =>
      DECIMAL_REGEX.test(val) &&
      new Prisma.Decimal(val).gt(0) &&
      new Prisma.Decimal(val).lte(MAX_DECIMAL_19_4),
    {
      message:
        "Amount must be greater than zero and within Decimal(19,4) range",
    },
  );

export const nonNegativeDecimalStringSchema = z
  .string()
  .trim()
  .regex(
    DECIMAL_REGEX,
    "Must be a non-negative decimal with up to 4 decimal places",
  )
  .refine(
    (val) =>
      DECIMAL_REGEX.test(val) &&
      new Prisma.Decimal(val).lte(MAX_DECIMAL_19_4),
    {
      message: "Amount exceeds Decimal(19,4) maximum",
    },
  );

export const signedDecimalStringSchema = z
  .string()
  .trim()
  .regex(
    SIGNED_DECIMAL_REGEX,
    "Must be a signed decimal with up to 4 decimal places",
  )
  .refine(
    (val) =>
      SIGNED_DECIMAL_REGEX.test(val) &&
      new Prisma.Decimal(val).abs().lte(MAX_DECIMAL_19_4),
    {
      message: "Amount exceeds Decimal(19,4) range",
    },
  );

export const exchangeRateStringSchema = z
  .string()
  .trim()
  .regex(
    EXCHANGE_RATE_REGEX,
    "Exchange rate must be a positive decimal with up to 8 decimal places",
  )
  .refine(
    (val) =>
      EXCHANGE_RATE_REGEX.test(val) &&
      new Prisma.Decimal(val).gt(0) &&
      new Prisma.Decimal(val).lte(MAX_EXCHANGE_RATE),
    {
      message:
        "Exchange rate must be greater than zero and within Decimal(19,8) range",
    },
  );

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex code");

export const isoDateSchema = z
  .union([z.string().trim().min(1), z.date()])
  .transform((val, ctx) => {
    const d = val instanceof Date ? val : new Date(val);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date",
      });
      return z.NEVER;
    }
    return d;
  });

export function extractRequestMeta(headers: Headers): RequestMeta {
  return {
    ipAddress: headers.get("x-forwarded-for"),
    userAgent: headers.get("user-agent"),
  };
}
