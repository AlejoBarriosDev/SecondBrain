import { Prisma, TransactionType } from "@prisma/client";

const MAX_DECIMAL_19_4 = new Prisma.Decimal("999999999999999.9999");

const KNOWN_CURRENCIES = new Set([
  "USD",
  "EUR",
  "COP",
  "MXN",
  "ARS",
  "CLP",
  "PEN",
  "GBP",
]);

const THOUSANDS_DOT_CURRENCIES = new Set(["COP", "CLP", "ARS"]);

export interface RuleParseInput {
  fromAddress?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  pdfText?: string | null;
  defaultCurrency?: string;
}

export interface PdfStatementRow {
  date: Date | null;
  description: string;
  amount: string;
  currency: string | null;
  type: TransactionType;
}

export interface RuleParseResult {
  type: TransactionType | null;
  amount: string | null;
  currency: string | null;
  merchant: string | null;
  description: string | null;
  date: Date | null;
  accountLastFour: string | null;
  categoryHint: string | null;
  confidence: number;
  matchedRules: string[];
  statementRows: PdfStatementRow[];
}

/**
 * Normalizes US ("1,234.56") and ES/LATAM ("1.234,56", "12,50", "50.000" COP)
 * monetary strings into exact Decimal(19,4) strings with zero JS float arithmetic.
 * Returns null if invalid, <= 0, or out of Decimal(19,4) bounds.
 */
export function normalizeAmountString(
  raw: string,
  currencyHint?: string | null,
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  // Strip currency codes, symbols, whitespace, and leading sign
  let cleaned = raw
    .trim()
    .replace(/\b(?:USD|EUR|COP|MXN|ARS|CLP|PEN|GBP)\b/gi, "")
    .replace(/US\$|U\$S|[$€£\s]/g, "")
    .replace(/^[+-]/, "");

  if (!cleaned || !/^\d[\d.,]*$/.test(cleaned)) {
    return null;
  }

  // Trim trailing punctuation (e.g. sentence-ending period "45.50.")
  cleaned = cleaned.replace(/[.,]+$/, "");
  if (!cleaned) {
    return null;
  }

  const normalizedCurrency = currencyHint?.trim().toUpperCase() ?? null;
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const commaCount = (cleaned.match(/,/g) ?? []).length;

  let canonical: string;

  if (dotCount > 0 && commaCount > 0) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot) {
      // ES/EU format: 1.234,56 -> 1234.56
      canonical = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US format: 1,234.56 -> 1234.56
      canonical = cleaned.replace(/,/g, "");
    }
  } else if (commaCount > 1) {
    // Multiple commas -> thousands separators (e.g. 1,234,567)
    canonical = cleaned.replace(/,/g, "");
  } else if (dotCount > 1) {
    // Multiple dots -> thousands separators (e.g. 1.234.567)
    canonical = cleaned.replace(/\./g, "");
  } else if (commaCount === 1) {
    const [intPart, fracPart] = cleaned.split(",");
    if (!intPart || !fracPart) {
      return null;
    }
    if (fracPart.length === 1 || fracPart.length === 2) {
      // Decimal comma: 12,50 -> 12.50
      canonical = `${intPart}.${fracPart}`;
    } else if (fracPart.length === 3) {
      // Thousands comma: 1,200 -> 1200
      canonical = `${intPart}${fracPart}`;
    } else if (fracPart.length === 4) {
      canonical = `${intPart}.${fracPart}`;
    } else {
      return null;
    }
  } else if (dotCount === 1) {
    const [intPart, fracPart] = cleaned.split(".");
    if (!intPart || !fracPart) {
      return null;
    }
    if (
      fracPart.length === 3 &&
      normalizedCurrency &&
      THOUSANDS_DOT_CURRENCIES.has(normalizedCurrency)
    ) {
      // LATAM thousands dot for COP/CLP/ARS: 50.000 -> 50000
      canonical = `${intPart}${fracPart}`;
    } else if (fracPart.length <= 4) {
      canonical = `${intPart}.${fracPart}`;
    } else {
      return null;
    }
  } else {
    canonical = cleaned;
  }

  if (!/^\d+(\.\d{1,4})?$/.test(canonical)) {
    return null;
  }

  try {
    const dec = new Prisma.Decimal(canonical);
    if (!dec.isFinite() || dec.lte(0) || dec.gt(MAX_DECIMAL_19_4)) {
      return null;
    }
    return dec.toFixed(4);
  } catch {
    return null;
  }
}

function symbolToCurrency(symbol: string | undefined): string | null {
  if (!symbol) return null;
  const s = symbol.trim().toUpperCase();
  if (s === "US$" || s === "U$S") return "USD";
  if (s === "€") return "EUR";
  if (s === "£") return "GBP";
  return null;
}

function detectTransactionType(text: string): {
  type: TransactionType | null;
  rule: string | null;
} {
  const lower = text.toLowerCase();

  // Check strong expense cues first for card purchases/charges
  // (e.g. "credit card purchase", "compra aprobada", "debit card purchase")
  if (
    /\b(?:purchase|bought|spent|card\s+charge|charged|debit\s+card|compra\s+aprobada|compra\s+realizada|compra\s+con|compra\s+por|cargo\s+realizado|cargo\s+a\s+tu|cobro|consumo|pago\s+de\s+factura|retiro|withdrawal|invoice\s+paid|subscription\s+renewal|suscripci[oó]n)\b/i.test(
      lower,
    )
  ) {
    return { type: TransactionType.EXPENSE, rule: "type:expense_strong" };
  }

  // Check transfer cues
  if (
    /\b(?:wire\s+transfer|bank\s+transfer|ach\s+transfer|transfer\s+between|transferencia\s+entre|traspaso|transferencia\s+enviada|sent\s+a\s+transfer)\b/i.test(
      lower,
    )
  ) {
    return { type: TransactionType.TRANSFER, rule: "type:transfer_strong" };
  }

  // Check income cues
  if (
    /\b(?:direct\s+deposit|payroll|salary|refund|reimbursement|payment\s+received|credited\s+to\s+your|deposit\s+of|dep[oó]sito\s+recibido|abono\s+recibido|n[oó]mina|salario|reembolso|devoluci[oó]n|pago\s+recibido|ingreso\s+recibido|transferencia\s+recibida|acreditado)\b/i.test(
      lower,
    )
  ) {
    return { type: TransactionType.INCOME, rule: "type:income_strong" };
  }

  // Secondary cues
  if (/\b(?:transfer|transferencia|zelle|bizum)\b/i.test(lower)) {
    return { type: TransactionType.TRANSFER, rule: "type:transfer_secondary" };
  }

  if (/\b(?:deposit|dep[oó]sito|abono|income|ingreso)\b/i.test(lower)) {
    return { type: TransactionType.INCOME, rule: "type:income_secondary" };
  }

  if (
    /\b(?:charge|debit|d[eé]bito|payment|pago|paid|bill|factura|compra|expense|gasto)\b/i.test(
      lower,
    )
  ) {
    return { type: TransactionType.EXPENSE, rule: "type:expense_secondary" };
  }

  return { type: null, rule: null };
}

interface AmountMatch {
  amount: string;
  currency: string | null;
  explicitCurrency: boolean;
  rule: string;
}

function extractAmountAndCurrency(
  text: string,
  defaultCurrency?: string,
): AmountMatch | null {
  // 1. Explicit ISO code before amount: "USD 45.50", "COP 50.000", "EUR 12,50"
  const codeBeforeRegex =
    /\b(USD|EUR|COP|MXN|ARS|CLP|PEN|GBP)\s*\$?\s*(\d[\d.,]*)/gi;
  for (const match of text.matchAll(codeBeforeRegex)) {
    const code = match[1]?.toUpperCase() ?? null;
    const raw = match[2] ?? "";
    const normalized = normalizeAmountString(raw, code);
    if (normalized) {
      return {
        amount: normalized,
        currency: code,
        explicitCurrency: true,
        rule: "amount:iso_prefix",
      };
    }
  }

  // 2. Symbol + amount + optional trailing ISO code: "$45.50 USD", "€12,50", "US$ 80.00"
  const symbolRegex =
    /(US\$|U\$S|€|£|\$)\s*(\d[\d.,]*)(?:\s*(USD|EUR|COP|MXN|ARS|CLP|PEN|GBP)\b)?/gi;
  for (const match of text.matchAll(symbolRegex)) {
    const sym = match[1];
    const raw = match[2] ?? "";
    const trailingCode = match[3]?.toUpperCase() ?? null;
    const currency =
      trailingCode ??
      symbolToCurrency(sym) ??
      (defaultCurrency && KNOWN_CURRENCIES.has(defaultCurrency.toUpperCase())
        ? defaultCurrency.toUpperCase()
        : null);
    const normalized = normalizeAmountString(raw, currency);
    if (normalized) {
      return {
        amount: normalized,
        currency,
        explicitCurrency: Boolean(trailingCode || symbolToCurrency(sym)),
        rule: "amount:symbol_prefix",
      };
    }
  }

  // 3. Amount followed by ISO code: "45.50 USD", "1.234,56 EUR"
  const codeAfterRegex =
    /(\d[\d.,]*)\s*(USD|EUR|COP|MXN|ARS|CLP|PEN|GBP)\b/gi;
  for (const match of text.matchAll(codeAfterRegex)) {
    const raw = match[1] ?? "";
    const code = match[2]?.toUpperCase() ?? null;
    const normalized = normalizeAmountString(raw, code);
    if (normalized) {
      return {
        amount: normalized,
        currency: code,
        explicitCurrency: true,
        rule: "amount:iso_suffix",
      };
    }
  }

  // 4. Keyword-anchored amount: "Monto: 45.50", "Total: 120.00"
  const keywordRegex =
    /\b(?:amount|total|monto|valor|importe)\s*[:\-]\s*(\d[\d.,]*)/gi;
  for (const match of text.matchAll(keywordRegex)) {
    const raw = match[1] ?? "";
    const fallbackCurr =
      defaultCurrency && KNOWN_CURRENCIES.has(defaultCurrency.toUpperCase())
        ? defaultCurrency.toUpperCase()
        : null;
    const normalized = normalizeAmountString(raw, fallbackCurr);
    if (normalized) {
      return {
        amount: normalized,
        currency: fallbackCurr,
        explicitCurrency: false,
        rule: "amount:keyword_labeled",
      };
    }
  }

  return null;
}

function cleanMerchant(raw: string): string | null {
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-:.,;]+|[\s\-:.,;]+$/g, "")
    .trim();

  if (cleaned.length < 2 || cleaned.length > 120) {
    return null;
  }

  // Reject pure numbers or date tokens
  if (/^[\d\s/.-]+$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function extractMerchant(text: string): {
  merchant: string | null;
  rule: string | null;
} {
  // 1. Explicit labeled merchant
  const labeled = text.match(
    /\b(?:merchant|comercio|establecimiento|beneficiario|store|vendor)\s*[:\-]\s*([^\n\r.;,]{2,80})/i,
  );
  if (labeled?.[1]) {
    const m = cleanMerchant(labeled[1]);
    if (m) return { merchant: m, rule: "merchant:labeled" };
  }

  // 2. Prepositional EN/ES: "at Whole Foods Market on 2026-11-20", "en Amazon Web Services", "en Cafe Central"
  const prepRegex =
    /\b(?:at|en|to|a\s+favor\s+de)\s+([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9&'.\- ]{1,65}?)(?=\s+(?:on|el|for|por|with|con|using|usando|ref|auth|card|tarjeta|ending|terminada|finalizada|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b|[.,;!\n\r]|$)/g;

  for (const match of text.matchAll(prepRegex)) {
    const candidate = match[1];
    if (!candidate) continue;
    // Skip common non-merchant phrases like "your account", "su cuenta"
    if (/^(?:your|su|tu|the|la|el|las|los)\b/i.test(candidate.trim())) {
      continue;
    }
    const m = cleanMerchant(candidate);
    if (m) return { merchant: m, rule: "merchant:preposition" };
  }

  return { merchant: null, rule: null };
}

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  ene: 0,
  enero: 0,
  feb: 1,
  february: 1,
  febrero: 1,
  mar: 2,
  march: 2,
  marzo: 2,
  apr: 3,
  april: 3,
  abr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  jun: 5,
  june: 5,
  junio: 5,
  jul: 6,
  july: 6,
  julio: 6,
  aug: 7,
  august: 7,
  ago: 7,
  agosto: 7,
  sep: 8,
  sept: 8,
  september: 8,
  septiembre: 8,
  oct: 9,
  october: 9,
  octubre: 9,
  nov: 10,
  november: 10,
  noviembre: 10,
  dec: 11,
  december: 11,
  dic: 11,
  diciembre: 11,
};

function makeSafeUtcDate(
  year: number,
  monthZeroBased: number,
  day: number,
): Date | null {
  if (
    year < 2000 ||
    year > 2100 ||
    monthZeroBased < 0 ||
    monthZeroBased > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const d = new Date(Date.UTC(year, monthZeroBased, day, 12, 0, 0));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== monthZeroBased ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function extractDate(text: string): Date | null {
  // 1. ISO YYYY-MM-DD
  const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    return makeSafeUtcDate(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
    );
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmy = text.match(
    /\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](20\d{2})\b/,
  );
  if (dmy) {
    return makeSafeUtcDate(
      Number(dmy[3]),
      Number(dmy[2]) - 1,
      Number(dmy[1]),
    );
  }

  // 3. EN month name: "Nov 20, 2026" or "November 20 2026"
  const enMonth = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (enMonth?.[1] && enMonth[2] && enMonth[3]) {
    const m = MONTH_MAP[enMonth[1].toLowerCase()];
    if (m !== undefined) {
      return makeSafeUtcDate(Number(enMonth[3]), m, Number(enMonth[2]));
    }
  }

  // 4. ES month name: "20 de noviembre de 2026"
  const esMonth = text.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(20\d{2})\b/i,
  );
  if (esMonth?.[1] && esMonth[2] && esMonth[3]) {
    const m = MONTH_MAP[esMonth[2].toLowerCase()];
    if (m !== undefined) {
      return makeSafeUtcDate(Number(esMonth[3]), m, Number(esMonth[1]));
    }
  }

  return null;
}

function extractAccountLastFour(text: string): string | null {
  const match = text.match(
    /(?:ending\s+in|terminada\s+en|finalizada\s+en|card\s*\*+|tarjeta\s*\*+|\*{2,4}|x{2,4})\s*(\d{4})\b/i,
  );
  return match?.[1] ?? null;
}

function detectCategoryHint(text: string): string | null {
  const lower = text.toLowerCase();
  if (
    /\b(?:whole\s+foods|supermarket|grocery|groceries|supermercado|mercado|carrefour|walmart|costco|exito|jumbo|bakery)\b/i.test(
      lower,
    )
  ) {
    return "Groceries";
  }
  if (
    /\b(?:cafe|coffee|starbucks|restaurant|restaurante|uber\s*eats|rappi|dining|pizza|burger)\b/i.test(
      lower,
    )
  ) {
    return "Dining";
  }
  if (
    /\b(?:amazon\s+web\s+services|aws|vercel|github|openai|netflix|spotify|icloud|software|cloud|subscription)\b/i.test(
      lower,
    )
  ) {
    return "Software & Subscriptions";
  }
  if (
    /\b(?:airlines|airline|flight|vuelo|hotel|airbnb|uber|lyft|cabify|metro|transport)\b/i.test(
      lower,
    )
  ) {
    return "Travel & Transport";
  }
  if (/\b(?:payroll|salary|n[oó]mina|salario)\b/i.test(lower)) {
    return "Salary";
  }
  if (
    /\b(?:electricity|water|internet|gas|utility|utilities|servicios\s+p[uú]blicos)\b/i.test(
      lower,
    )
  ) {
    return "Utilities";
  }
  return null;
}

/**
 * Extracts structured tabular transaction rows from PDF bank statement text.
 * Recognizes lines like: "2026-11-20  Whole Foods Market  USD 45.50" or "20/11/2026 Cafe Central -64.25"
 */
export function parsePdfStatementRows(
  pdfText: string,
  defaultCurrency?: string,
): PdfStatementRow[] {
  if (!pdfText || !pdfText.trim()) {
    return [];
  }

  const rows: PdfStatementRow[] = [];
  const lines = pdfText.split(/\r?\n/);
  const rowRegex =
    /^\s*((?:20\d{2}-\d{2}-\d{2})|(?:\d{2}[\/\-]\d{2}[\/\-]20\d{2}))\s+(.+?)\s+([+-]?(?:(?:USD|EUR|COP|MXN|ARS|CLP|PEN|GBP)\s*)?[$€£]?\s*\d[\d.,]*(?:\s*(?:USD|EUR|COP|MXN|ARS|CLP|PEN|GBP))?)\s*$/i;

  for (const line of lines) {
    const match = line.match(rowRegex);
    if (!match?.[1] || !match[2] || !match[3]) continue;

    const date = extractDate(match[1]);
    const desc = match[2].trim();
    const rawAmountToken = match[3].trim();
    const isPositiveSign = rawAmountToken.startsWith("+");
    const isNegativeSign = rawAmountToken.startsWith("-");

    const extracted = extractAmountAndCurrency(rawAmountToken, defaultCurrency);
    const amount =
      extracted?.amount ??
      normalizeAmountString(rawAmountToken, defaultCurrency);
    if (!amount) continue;

    const inferredType = isPositiveSign
      ? TransactionType.INCOME
      : isNegativeSign
        ? TransactionType.EXPENSE
        : detectTransactionType(desc).type ?? TransactionType.EXPENSE;

    rows.push({
      date,
      description: desc.slice(0, 255),
      amount,
      currency:
        extracted?.currency ??
        (defaultCurrency && KNOWN_CURRENCIES.has(defaultCurrency.toUpperCase())
          ? defaultCurrency.toUpperCase()
          : null),
      type: inferredType,
    });
  }

  return rows;
}

export function parseWithRules(input: RuleParseInput): RuleParseResult {
  const subject = input.subject?.trim() ?? "";
  const body = input.bodyText?.trim() ?? "";
  const pdf = input.pdfText?.trim() ?? "";
  const defaultCurrency = input.defaultCurrency?.trim().toUpperCase();

  // Prefer PDF text + body + subject for extraction; keep order so structured content is scanned cleanly
  const combinedText = [pdf, body, subject].filter(Boolean).join("\n");
  const matchedRules: string[] = [];

  const statementRows = parsePdfStatementRows(pdf, defaultCurrency);
  if (statementRows.length > 0) {
    matchedRules.push(`pdf:statement_rows(${statementRows.length})`);
  }

  // Extract amount & currency (prefer PDF/body first, fallback to subject)
  let amountMatch =
    (pdf ? extractAmountAndCurrency(pdf, defaultCurrency) : null) ??
    (body ? extractAmountAndCurrency(body, defaultCurrency) : null) ??
    (subject ? extractAmountAndCurrency(subject, defaultCurrency) : null);

  if (!amountMatch && statementRows[0]) {
    amountMatch = {
      amount: statementRows[0].amount,
      currency: statementRows[0].currency,
      explicitCurrency: Boolean(statementRows[0].currency),
      rule: "amount:pdf_statement_row",
    };
  }

  if (amountMatch) {
    matchedRules.push(amountMatch.rule);
  }

  // Detect transaction type
  const typeResult = detectTransactionType(combinedText);
  let type = typeResult.type;
  if (typeResult.rule) {
    matchedRules.push(typeResult.rule);
  } else if (statementRows[0]) {
    type = statementRows[0].type;
    matchedRules.push("type:pdf_statement_row");
  }

  // Extract merchant (prefer body/pdf with richer detail, fallback to subject)
  const merchantResult =
    (pdf ? extractMerchant(pdf) : { merchant: null, rule: null }).merchant
      ? extractMerchant(pdf)
      : (body ? extractMerchant(body) : { merchant: null, rule: null }).merchant
        ? extractMerchant(body)
        : extractMerchant(subject);

  let merchant = merchantResult.merchant;
  if (merchantResult.rule) {
    matchedRules.push(merchantResult.rule);
  } else if (statementRows[0]?.description) {
    merchant = cleanMerchant(statementRows[0].description);
    if (merchant) matchedRules.push("merchant:pdf_statement_row");
  }

  // Extract date
  const date = extractDate(combinedText) ?? statementRows[0]?.date ?? null;
  if (date) {
    matchedRules.push("date:extracted");
  }

  const accountLastFour = extractAccountLastFour(combinedText);
  if (accountLastFour) {
    matchedRules.push("account:last_four");
  }

  const categoryHint = detectCategoryHint(combinedText);
  if (categoryHint) {
    matchedRules.push(`category:${categoryHint}`);
  }

  // Compute deterministic confidence score in [0.0000, 0.9800]
  let confidence = 0.15;
  if (amountMatch) {
    confidence = 0.45;
    if (type) confidence += 0.2;
    if (amountMatch.explicitCurrency) confidence += 0.1;
    if (merchant) confidence += 0.15;
    if (date) confidence += 0.05;
    if (statementRows.length > 0) confidence += 0.03;
    confidence = Math.min(0.98, Math.round(confidence * 10000) / 10000);
  } else if (type) {
    // Financial keywords without an amount -> still low confidence so LLM can assist
    confidence = 0.25;
  }

  const description =
    merchant ??
    (subject.length > 0 ? subject.slice(0, 255) : null) ??
    (statementRows[0]?.description ?? null);

  return {
    type: amountMatch ? type ?? TransactionType.EXPENSE : type,
    amount: amountMatch?.amount ?? null,
    currency: amountMatch?.currency ?? null,
    merchant,
    description,
    date,
    accountLastFour,
    categoryHint,
    confidence,
    matchedRules,
    statementRows,
  };
}
