/**
 * Pure formatting helpers for monetary decimals, dates, percentages, and user initials.
 */

export function formatMoney(
  value: string | number | null | undefined,
  currency = "USD",
  locale = "en-US",
): string {
  const trimmedCurrency =
    typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const normalizedCurrency = /^[A-Z]{3}$/.test(trimmedCurrency)
    ? trimmedCurrency
    : "USD";

  if (value === null || value === undefined || value === "") {
    return formatMoney(0, normalizedCurrency, locale);
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return `${normalizedCurrency} 0.00`;
  }

  const safeNumeric = Object.is(numeric, -0) || numeric === 0 ? 0 : numeric;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeNumeric);
  } catch {
    return `${normalizedCurrency} ${safeNumeric.toFixed(2)}`;
  }
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0%";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

export function formatDate(
  iso: string | Date | null | undefined,
  locale = "es-ES",
): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatDateTime(
  iso: string | Date | null | undefined,
  locale = "es-ES",
): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function toDateInputValue(iso?: string | Date | null): string {
  if (!iso) {
    return new Date().toISOString().slice(0, 10);
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Cleans user decimal text input into a normalized string suitable for Zod Decimal(19,4) schemas.
 * Handles both European/Spanish (e.g. "1.250,50", "125,50", "0,125") and English (e.g. "1,250.50", "1,000") formats.
 */
export function normalizeDecimalInput(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!cleaned) return "";

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // European/Spanish format: dots are thousands separators, comma is decimal separator
      return cleaned.replace(/\./g, "").replace(/,/g, ".");
    }
    // English format: commas are thousands separators, dot is decimal separator
    return cleaned.replace(/,/g, "");
  }

  if (hasComma) {
    const parts = cleaned.split(",");
    const isThousandsGroup =
      parts.length === 2 &&
      parts[1].length === 3 &&
      parts[0].replace(/^-/, "") !== "0";

    if (parts.length === 2 && parts[1].length <= 4 && !isThousandsGroup) {
      return `${parts[0]}.${parts[1]}`;
    }
    return cleaned.replace(/,/g, "");
  }

  if (hasDot) {
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      return cleaned.replace(/\./g, "");
    }
    return cleaned;
  }

  return cleaned;
}

export function getInitials(
  name?: string | null,
  email?: string | null,
): string {
  const source = name?.trim() || email?.trim() || "SB";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = Array.from(words[0])[0] ?? "";
    const second = Array.from(words[1])[0] ?? "";
    return `${first}${second}`.toUpperCase();
  }
  return Array.from(source).slice(0, 2).join("").toUpperCase();
}
