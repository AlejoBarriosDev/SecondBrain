import dotenv from "dotenv";
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Cookie,
  type Page,
} from "@playwright/test";

// Load .env before any Prisma or BetterAuth module initializes.
dotenv.config();

if (
  !process.env.DATABASE_URL?.includes("_test") &&
  process.env.DATABASE_URL_TEST
) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  process.env.DIRECT_URL = process.env.DATABASE_URL_TEST;
}

export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export const ALLOWED_EMAIL =
  process.env.ALLOWED_EMAIL?.trim() || "owner@secondbrain.local";

export interface ApiOkResponse<T> {
  ok: true;
  data: T;
}

export interface ApiPaginatedMeta {
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiPaginatedResponse<T> {
  ok: true;
  data: T[];
  meta: ApiPaginatedMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export interface ApiErrorResponse {
  ok: false;
  error: ApiErrorPayload;
}

export interface OwnerSession {
  user: {
    id: string;
    email: string;
    name: string;
  };
  cookies: Cookie[];
  cookieHeader: string;
  api: APIRequestContext;
  dispose: () => Promise<void>;
}

export interface ForbiddenSession {
  userId: string;
  cookies: Cookie[];
  cookieHeader: string;
  api: APIRequestContext;
  dispose: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared Domain DTOs (strict opaque-box HTTP shapes derived from PROJECT.md)
// ---------------------------------------------------------------------------

export type ThemeMode = "DARK" | "LIGHT" | "SYSTEM";
export type FinancialAccountType = "BANK" | "CASH" | "CREDIT_CARD";
export type TransactionType = "INCOME" | "EXPENSE" | "TRANSFER";
export type EmailImportStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export interface UserSettingsDto {
  id: string;
  userId: string;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  theme: ThemeMode;
  fiscalMonthStartDay: number;
  aiParserEnabled: boolean;
}

export interface ModuleConfigDto {
  id: string;
  userId: string;
  moduleKey: string;
  enabled: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
}

export interface TagDto {
  id: string;
  userId: string;
  name: string;
  color: string;
}

export interface EntityLinkDto {
  id: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogDto {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface FinancialAccountDto {
  id: string;
  userId?: string;
  name: string;
  type: FinancialAccountType;
  currency: string;
  balance: string;
  creditLimit?: string | null;
  statementClosingDay?: number | null;
  paymentDueDay?: number | null;
  institution?: string | null;
  lastFour?: string | null;
  isArchived: boolean;
}

export interface CategoryDto {
  id: string;
  name: string;
  type: TransactionType;
  parentId?: string | null;
  icon?: string | null;
  color?: string | null;
  isSystem?: boolean;
}

export interface TransactionDto {
  id: string;
  accountId: string;
  categoryId?: string | null;
  type: TransactionType;
  amount: string;
  currency: string;
  occurredAt: string;
  description: string;
  merchant?: string | null;
  notes?: string | null;
  status: string;
  transferGroupId?: string | null;
  transferDirection?: "OUT" | "IN" | null;
  counterpartyAccountId?: string | null;
  recurringRuleId?: string | null;
  emailImportItemId?: string | null;
}

export interface TransferResultDto {
  transferGroupId: string;
  outTransaction?: TransactionDto;
  inTransaction?: TransactionDto;
  legs?: TransactionDto[];
}

export interface BudgetDto {
  id: string;
  categoryId: string;
  year: number;
  month: number;
  amount: string;
  currency: string;
  alertThresholdPct: number;
  rollover?: boolean;
  spent?: string;
  remaining?: string;
  percentUsed?: number;
  usagePct?: number;
  status?: string;
  alertStatus?: "OK" | "WARNING" | "EXCEEDED";
  alertLevel?: string;
  isWarning?: boolean;
  isExceeded?: boolean;
}

export interface RecurringRunResultDto {
  processedCount?: number;
  skippedCount?: number;
  created?: number;
  transactionsCreated?: number;
  processed?: number;
}

/**
 * Strictly extracts the numeric count of processed/created recurring items
 * from a POST /api/finances/recurring/run response. Throws if no finite
 * numeric count field is present (never falls back to 0).
 */
export function extractRecurringRunCount(run: RecurringRunResultDto): number {
  const candidates = [
    run.processedCount,
    run.created,
    run.transactionsCreated,
    run.processed,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  throw new Error(
    `Recurring run response missing finite numeric count field: ${JSON.stringify(run)}`,
  );
}

export interface RecurringRuleDto {
  id: string;
  name: string;
  type: TransactionType;
  amount: string;
  currency: string;
  accountId: string;
  categoryId?: string | null;
  frequency: string;
  interval: number;
  dayOfMonth?: number | null;
  startDate: string;
  nextRunAt: string;
  lastRunAt?: string | null;
  isActive: boolean;
}

export interface EmailImportItemDto {
  id: string;
  externalMessageId: string;
  fromAddress?: string | null;
  subject?: string | null;
  receivedAt: string;
  hasPdfAttachment: boolean;
  parserSource: string;
  parserNotes?: string | null;
  confidence?: string | number | null;
  status: EmailImportStatus;
  parsedType?: TransactionType | null;
  parsedAmount?: string | null;
  parsedCurrency?: string | null;
  parsedMerchant?: string | null;
  parsedDescription?: string | null;
  parsedDate?: string | null;
  suggestedAccountId?: string | null;
  suggestedCategoryId?: string | null;
}

export interface DashboardDto {
  netWorth: string;
  accounts?: FinancialAccountDto[];
  pendingInboxCount?: number;
  budgets?: BudgetDto[];
  recentTransactions?: TransactionDto[];
  upcomingRecurring?: RecurringRuleDto[];
  monthlyCashflow?: {
    income: string;
    expense: string;
    net?: string;
  };
}

// ---------------------------------------------------------------------------
// Lazy helper loaders (ensures dotenv/DATABASE_URL_TEST runs before Prisma)
// ---------------------------------------------------------------------------

async function loadTestHelpers() {
  const [{ resetTestDatabase }, { getTestAuthHelpers }] = await Promise.all([
    import("../helpers/db-reset"),
    import("../helpers/test-auth"),
  ]);
  return { resetTestDatabase, getTestAuthHelpers };
}

function toPlaywrightCookies(
  rawCookies: ReadonlyArray<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    expires?: number;
  }>,
): Cookie[] {
  return rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || "localhost",
    path: c.path || "/",
    expires: typeof c.expires === "number" ? c.expires : -1,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: c.sameSite ?? "Lax",
  }));
}

/**
 * Resets the isolated test database, creates the authorized owner user,
 * logs in via BetterAuth testUtils(), and returns both Playwright cookies
 * and an authenticated APIRequestContext.
 */
export async function resetAndCreateOwnerSession(): Promise<OwnerSession> {
  const { resetTestDatabase, getTestAuthHelpers } = await loadTestHelpers();
  await resetTestDatabase();

  const tu = await getTestAuthHelpers();
  const created = await tu.saveUser(
    tu.createUser({
      email: ALLOWED_EMAIL,
      name: "SecondBrain Owner",
    }),
  );

  const loginResult = await tu.login({ userId: created.id });
  const cookieHeader = loginResult.headers.get("cookie") ?? "";
  const cookies = toPlaywrightCookies(loginResult.cookies);

  const api = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      cookie: cookieHeader,
    },
  });

  return {
    user: {
      id: created.id,
      email: created.email,
      name: created.name,
    },
    cookies,
    cookieHeader,
    api,
    dispose: async () => {
      await api.dispose();
    },
  };
}

/**
 * Creates a clean APIRequestContext with no authentication cookies.
 */
export async function createUnauthenticatedApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
  });
}

/**
 * Creates a signed BetterAuth session whose underlying user email is mutated
 * to an unauthorized address so live HTTP requests hit `requireSession()`
 * and receive HTTP 403 FORBIDDEN (or /login redirect on page routes).
 */
export async function createForbiddenSession(): Promise<ForbiddenSession> {
  const { resetTestDatabase, getTestAuthHelpers } = await loadTestHelpers();
  const { prisma } = await import("@/lib/db/prisma");

  await resetTestDatabase();

  const tu = await getTestAuthHelpers();
  const user = await tu.saveUser(
    tu.createUser({
      email: ALLOWED_EMAIL,
      name: "Temporary User",
    }),
  );

  const loginResult = await tu.login({ userId: user.id });

  await prisma.user.update({
    where: { id: user.id },
    data: { email: "intruder@evil.test" },
  });

  const cookieHeader = loginResult.headers.get("cookie") ?? "";
  const cookies = toPlaywrightCookies(loginResult.cookies);

  const api = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      cookie: cookieHeader,
    },
  });

  return {
    userId: user.id,
    cookies,
    cookieHeader,
    api,
    dispose: async () => {
      await api.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// API Response Envelope Assertions
// ---------------------------------------------------------------------------

export async function expectOkJson<T>(
  res: APIResponse,
  expectedStatus?: number,
): Promise<T> {
  if (typeof expectedStatus === "number") {
    expect(res.status(), await res.text()).toBe(expectedStatus);
  } else {
    expect(res.status(), await res.text()).toBeGreaterThanOrEqual(200);
    expect(res.status(), await res.text()).toBeLessThan(300);
  }

  const body = (await res.json()) as ApiOkResponse<T>;
  expect(body.ok).toBe(true);
  expect(body.data).toBeDefined();
  return body.data;
}

export async function expectPaginatedJson<T>(
  res: APIResponse,
  expectedStatus = 200,
): Promise<ApiPaginatedResponse<T>> {
  expect(res.status(), await res.text()).toBe(expectedStatus);
  const body = (await res.json()) as ApiPaginatedResponse<T>;
  expect(body.ok).toBe(true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(typeof body.meta?.total).toBe("number");
  expect(typeof body.meta?.page).toBe("number");
  expect(typeof body.meta?.pageSize).toBe("number");
  return body;
}

export async function expectErrorJson(
  res: APIResponse,
  expectedStatus: number,
  expectedCode?: string,
): Promise<ApiErrorPayload> {
  expect(res.status(), await res.text()).toBe(expectedStatus);
  const body = (await res.json()) as ApiErrorResponse;
  expect(body.ok).toBe(false);
  expect(typeof body.error?.code).toBe("string");
  expect(typeof body.error?.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
  if (expectedCode) {
    expect(body.error.code).toBe(expectedCode);
  }
  return body.error;
}

// ---------------------------------------------------------------------------
// Minimal Valid PDF-1.4 Generator (for PARSE-01 & GMAIL-03)
// ---------------------------------------------------------------------------

function escapePdfLiteralString(input: string): string {
  return input
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

/**
 * Generates a genuine minimal valid PDF-1.4 binary encoded as base64
 * containing the provided text string rendered with Helvetica.
 */
export function buildMinimalPdfBase64(text: string): string {
  const escaped = escapePdfLiteralString(text);
  const streamContent = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const streamLength = Buffer.byteLength(streamContent, "utf8");

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}endstream\nendobj\n`,
  ];

  const header = "%PDF-1.4\n";
  const parts: string[] = [header];
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "utf8");

  for (const obj of objects) {
    offsets.push(cursor);
    parts.push(obj);
    cursor += Buffer.byteLength(obj, "utf8");
  }

  const xrefOffset = cursor;
  const xrefLines = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n \n`),
  ];
  parts.push(xrefLines.join(""));

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(trailer);

  return Buffer.from(parts.join(""), "utf8").toString("base64");
}

// ---------------------------------------------------------------------------
// CSS Color Luminance & PNG Magic Byte Helpers
// ---------------------------------------------------------------------------

function linearizeSrgbChannel(channel255: number): number {
  const s = channel255 / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Computes WCAG 2.1 relative luminance (0.0 = pure black, 1.0 = pure white)
 * from a CSS `rgb(...)` or `rgba(...)` color string.
 * Rejects malformed tokens (e.g. `rgb(., ., .)`) and transparent (`alpha === 0`)
 * colors so transparent backgrounds can never falsely pass dark-mode checks.
 */
export function parseRgbLuminance(cssColor: string): number {
  const match = cssColor
    .trim()
    .match(
      /^rgba?\(\s*([^\s,]+)\s*[,\s]\s*([^\s,]+)\s*[,\s]\s*([^\s,/)]+)(?:\s*[,/]\s*([^\s)]+))?\s*\)$/i,
    );
  if (!match) {
    throw new Error(`Unable to parse CSS rgb/rgba color: "${cssColor}"`);
  }

  const parseChannel = (token: string): number => {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
      throw new Error(`Invalid RGB channel "${token}" in "${cssColor}"`);
    }
    const value = Number(token);
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      throw new Error(`Out-of-range RGB channel "${token}" in "${cssColor}"`);
    }
    return value;
  };

  const r = parseChannel(match[1]);
  const g = parseChannel(match[2]);
  const b = parseChannel(match[3]);

  if (match[4] !== undefined) {
    const alphaToken = match[4];
    const isPercent = alphaToken.endsWith("%");
    const numStr = isPercent ? alphaToken.slice(0, -1) : alphaToken;
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(numStr)) {
      throw new Error(`Invalid alpha channel "${alphaToken}" in "${cssColor}"`);
    }
    const alpha = isPercent ? Number(numStr) / 100 : Number(numStr);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error(`Out-of-range alpha "${alphaToken}" in "${cssColor}"`);
    }
    if (alpha === 0) {
      throw new Error(
        `Transparent background "${cssColor}" cannot be evaluated for luminance`,
      );
    }
  }

  const R = linearizeSrgbChannel(r);
  const G = linearizeSrgbChannel(g);
  const B = linearizeSrgbChannel(b);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Measures the effective WCAG 2.1 relative luminance of the page background
 * by walking `[document.body, document.documentElement]` and resolving each
 * computed `backgroundColor` through a 1x1 2D canvas. Natively handles
 * Tailwind v4 `oklch(...)`, `color(srgb ...)`, `rgb(...)`, and `hsl(...)`
 * while skipping transparent layers (`alpha === 0`).
 */
export async function measureEffectiveBackgroundLuminance(
  page: Page,
): Promise<number> {
  const rgba = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable for luminance check");
    }

    const candidates: Array<Element | null> = [
      document.body,
      document.documentElement,
    ];

    for (const el of candidates) {
      if (!el) continue;
      const bg = window.getComputedStyle(el).backgroundColor;
      if (!bg || bg === "transparent") continue;

      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      const a = data[3] ?? 0;
      if (a > 0) {
        return {
          r: data[0] ?? 0,
          g: data[1] ?? 0,
          b: data[2] ?? 0,
          a,
        };
      }
    }

    return null;
  });

  if (!rgba || rgba.a === 0) {
    throw new Error(
      "Could not resolve an opaque background color on document.body or document.documentElement",
    );
  }

  const R = linearizeSrgbChannel(rgba.r);
  const G = linearizeSrgbChannel(rgba.g);
  const B = linearizeSrgbChannel(rgba.b);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Verifies the 8-byte PNG file signature (`\x89PNG\r\n\x1a\n`).
 */
export function isValidPngHeader(buf: Buffer): boolean {
  if (buf.length < PNG_MAGIC.length) {
    return false;
  }
  return buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}
