import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, RecurrenceFrequency } from "@prisma/client";
import {
  cleanMerchant,
  normalizeAmountString,
  parsePdfStatementRows,
  parseWithRules,
} from "@/modules/finances/rule-parser";
import { computeNextRunAt } from "@/modules/finances/recurring";
import { computeTransferInAmount } from "@/modules/finances/transfers";
import {
  assertDecimal19_4,
  assertDecimal19_8,
  MAX_DECIMAL_19_4,
  MAX_DECIMAL_19_8,
} from "@/lib/db/decimal";
import { ValidationError } from "@/lib/api/errors";
import { isPublicPath, middleware } from "@/middleware";

describe("Tier 5 Adversarial — Rule Parser ReDoS Hardening", () => {
  it("completes codeAfterRegex pathological 50KB input in linear time (< 100ms)", () => {
    const start1 = performance.now();
    const res1 = parseWithRules({ bodyText: "1".repeat(50_000) });
    const elapsed1 = performance.now() - start1;

    expect(elapsed1).toBeLessThan(100);
    expect(res1.amount).toBeNull();

    const start2 = performance.now();
    const res2 = parseWithRules({ bodyText: "1.".repeat(25_000) });
    const elapsed2 = performance.now() - start2;

    expect(elapsed2).toBeLessThan(100);
    expect(res2.amount).toBeNull();
  });

  it("completes codeBeforeRegex pathological 50KB whitespace input in linear time (< 100ms)", () => {
    const start = performance.now();
    const res = parseWithRules({
      bodyText: `USD${" ".repeat(50_000)}X`,
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(res.amount).toBeNull();
  });

  it("completes parsePdfStatementRows cubic ReDoS vector in linear time (< 100ms)", () => {
    const pathological = `2026-11-20 a ${" ".repeat(20_000)}1!`;
    const start = performance.now();
    const rows = parsePdfStatementRows(pathological, "USD");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(rows).toEqual([]);
  });

  it("completes normalizeAmountString pathological 50KB punctuation input in linear time (< 50ms)", () => {
    const start = performance.now();
    const result = normalizeAmountString(`1${".".repeat(50_000)}1`);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(result).toBeNull();
  });

  it("completes cleanMerchant pathological 50KB whitespace input in linear time (< 50ms)", () => {
    const start = performance.now();
    const result = cleanMerchant(`a${" ".repeat(50_000)}a`);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(result).toBeNull();
  });

  it("preserves accurate parsing for valid EN/ES emails and PDF statement rows", () => {
    const en = parseWithRules({
      subject: "Purchase alert",
      bodyText: "You spent 1.234,56 EUR at Whole Foods Market on 2026-11-20.",
    });
    expect(en.amount).toBe("1234.5600");
    expect(en.currency).toBe("EUR");
    expect(en.merchant).toBe("Whole Foods Market");

    const rows = parsePdfStatementRows(
      "2026-11-20   Whole Foods Market   USD 45.50\n20/11/2026   Cafe Central   -64.25",
      "USD",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.amount).toBe("45.5000");
    expect(rows[0]?.currency).toBe("USD");
    expect(rows[1]?.amount).toBe("64.2500");
  });
});

describe("Tier 5 Adversarial — Recurring Rule dayOfMonth & Leap-Year Anchor", () => {
  it("re-anchors MONTHLY dayOfMonth=31 across Feb -> Mar -> Apr -> May without drift", () => {
    const jan31 = new Date("2026-01-31T00:00:00.000Z");
    const feb28 = computeNextRunAt(jan31, RecurrenceFrequency.MONTHLY, 1, 31);
    expect(feb28.toISOString()).toBe("2026-02-28T00:00:00.000Z");

    const mar31 = computeNextRunAt(feb28, RecurrenceFrequency.MONTHLY, 1, 31);
    expect(mar31.toISOString()).toBe("2026-03-31T00:00:00.000Z");

    const apr30 = computeNextRunAt(mar31, RecurrenceFrequency.MONTHLY, 1, 31);
    expect(apr30.toISOString()).toBe("2026-04-30T00:00:00.000Z");

    const may31 = computeNextRunAt(apr30, RecurrenceFrequency.MONTHLY, 1, 31);
    expect(may31.toISOString()).toBe("2026-05-31T00:00:00.000Z");
  });

  it("re-anchors QUARTERLY dayOfMonth=30 across Nov 30 -> Feb 28 -> May 30", () => {
    const nov30 = new Date("2025-11-30T00:00:00.000Z");
    const feb28 = computeNextRunAt(nov30, RecurrenceFrequency.QUARTERLY, 1, 30);
    expect(feb28.toISOString()).toBe("2026-02-28T00:00:00.000Z");

    const may30 = computeNextRunAt(feb28, RecurrenceFrequency.QUARTERLY, 1, 30);
    expect(may30.toISOString()).toBe("2026-05-30T00:00:00.000Z");
  });

  it("re-anchors YEARLY leap-year Feb 29 across 2024 -> 2025..2027 -> 2028-02-29", () => {
    let cursor = new Date("2024-02-29T00:00:00.000Z");
    cursor = computeNextRunAt(cursor, RecurrenceFrequency.YEARLY, 1, 29);
    expect(cursor.toISOString()).toBe("2025-02-28T00:00:00.000Z");

    cursor = computeNextRunAt(cursor, RecurrenceFrequency.YEARLY, 1, 29);
    expect(cursor.toISOString()).toBe("2026-02-28T00:00:00.000Z");

    cursor = computeNextRunAt(cursor, RecurrenceFrequency.YEARLY, 1, 29);
    expect(cursor.toISOString()).toBe("2027-02-28T00:00:00.000Z");

    cursor = computeNextRunAt(cursor, RecurrenceFrequency.YEARLY, 1, 29);
    expect(cursor.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("Tier 5 Adversarial — Decimal(19,4) & Decimal(19,8) Overflow Pre-Checks", () => {
  it("accepts exact boundary values and rejects overflow with ValidationError", () => {
    expect(assertDecimal19_4(MAX_DECIMAL_19_4).equals(MAX_DECIMAL_19_4)).toBe(
      true,
    );
    expect(
      assertDecimal19_4(MAX_DECIMAL_19_4.neg()).equals(MAX_DECIMAL_19_4.neg()),
    ).toBe(true);
    expect(() =>
      assertDecimal19_4(new Prisma.Decimal("1000000000000000.0000")),
    ).toThrow(ValidationError);
    expect(() =>
      assertDecimal19_4(new Prisma.Decimal("-1000000000000000.0000")),
    ).toThrow(ValidationError);

    expect(assertDecimal19_8(MAX_DECIMAL_19_8).equals(MAX_DECIMAL_19_8)).toBe(
      true,
    );
    expect(() =>
      assertDecimal19_8(new Prisma.Decimal("100000000000.00000000")),
    ).toThrow(ValidationError);
  });

  it("rejects computeTransferInAmount derived exchangeRate > Decimal(19,8) and derived inAmount > Decimal(19,4)", () => {
    expect(() =>
      computeTransferInAmount(
        new Prisma.Decimal("0.0001"),
        "USD",
        "COP",
        { toAmount: "999999999999999.9999" },
      ),
    ).toThrow(ValidationError);

    expect(() =>
      computeTransferInAmount(
        new Prisma.Decimal("999999999999.0000"),
        "USD",
        "COP",
        { exchangeRate: "100000.00000000" },
      ),
    ).toThrow(ValidationError);
  });
});

describe("Tier 5 Adversarial — Middleware Segment Boundaries & Cron Bearer Passthrough", () => {
  it("enforces exact segment boundary for /api/auth and trailing-slash prefixes", () => {
    expect(isPublicPath("/api/auth")).toBe(true);
    expect(isPublicPath("/api/auth/get-session")).toBe(true);
    expect(isPublicPath("/icons/icon-192.png")).toBe(true);
    expect(isPublicPath("/_next/static/chunk.js")).toBe(true);

    expect(isPublicPath("/api/auth-evil")).toBe(false);
    expect(isPublicPath("/api/authz")).toBe(false);
    expect(isPublicPath("/api/authenticated/export")).toBe(false);
    expect(isPublicPath("/icons-evil/a.png")).toBe(false);
    expect(isPublicPath("/_next-evil/chunk.js")).toBe(false);
  });

  it("blocks unauthenticated /api/auth-evil with 401 JSON", async () => {
    const res = middleware(new NextRequest("http://localhost:3000/api/auth-evil"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("allows Bearer passthrough only on POST /api/finances/recurring/run", () => {
    const noAuth = middleware(
      new NextRequest("http://localhost:3000/api/finances/recurring/run", {
        method: "POST",
      }),
    );
    expect(noAuth.status).toBe(401);

    const withBearer = middleware(
      new NextRequest("http://localhost:3000/api/finances/recurring/run", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(withBearer.status).toBe(200);

    const getWithBearer = middleware(
      new NextRequest("http://localhost:3000/api/finances/recurring/run", {
        method: "GET",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(getWithBearer.status).toBe(401);

    const otherEndpointWithBearer = middleware(
      new NextRequest("http://localhost:3000/api/finances/accounts", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(otherEndpointWithBearer.status).toBe(401);
  });
});

describe("Tier 5 Adversarial — Service Worker Offline & Cache-Control Hardening", () => {
  function loadServiceWorker(options: {
    fetchImpl: (req: Request) => Promise<Response>;
  }) {
    const swSource = fs.readFileSync(
      path.join(process.cwd(), "public/sw.js"),
      "utf8",
    );
    const listeners = new Map<string, (event: unknown) => void>();
    const cachePutCalls: Array<{ url: string; cacheName: string }> = [];
    const cacheStore = new Map<string, Response>();

    const cachesMock = {
      match: async (req: Request | string) => {
        const key = typeof req === "string" ? req : req.url;
        return cacheStore.get(key);
      },
      open: async (cacheName: string) => ({
        put: async (req: Request, res: Response) => {
          cachePutCalls.push({ url: req.url, cacheName });
          cacheStore.set(req.url, res);
        },
        addAll: async () => {},
      }),
      keys: async () => [],
      delete: async () => true,
    };

    const selfObj = {
      location: { origin: "http://localhost:3000" },
      addEventListener: (name: string, fn: (event: unknown) => void) => {
        listeners.set(name, fn);
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    };

    const sandbox = {
      self: selfObj,
      caches: cachesMock,
      fetch: options.fetchImpl,
      Response,
      URL,
      Promise,
    };

    vm.runInNewContext(swSource, sandbox);

    const dispatchFetch = (req: {
      url: string;
      method?: string;
      mode?: string;
      destination?: string;
    }) => {
      let responded: Promise<Response> | undefined;
      const fetchHandler = listeners.get("fetch");
      if (!fetchHandler) {
        throw new Error("SW did not register a fetch listener");
      }
      fetchHandler({
        request: {
          url: req.url,
          method: req.method ?? "GET",
          mode: req.mode ?? "cors",
          destination: req.destination ?? "",
        },
        respondWith: (p: Promise<Response>) => {
          responded = p;
        },
      });
      return responded;
    };

    return { dispatchFetch, cachePutCalls };
  }

  it("returns a valid Response (Response.error()) instead of undefined on offline static cache miss", async () => {
    const { dispatchFetch } = loadServiceWorker({
      fetchImpl: () => Promise.reject(new TypeError("Network offline")),
    });

    const responsePromise = dispatchFetch({
      url: "http://localhost:3000/_next/static/chunks/uncached.js",
      method: "GET",
      destination: "script",
    });

    expect(responsePromise).toBeDefined();
    const res = await responsePromise;
    expect(res).toBeInstanceOf(Response);
    expect(res?.type).toBe("error");
  });

  it("does NOT cache responses with Cache-Control: private in STATIC_CACHE", async () => {
    const fakePrivateResponse = {
      ok: true,
      type: "basic",
      headers: new Headers({ "cache-control": "private, max-age=60" }),
      clone() {
        return fakePrivateResponse;
      },
    } as unknown as Response;

    const { dispatchFetch, cachePutCalls } = loadServiceWorker({
      fetchImpl: async () => fakePrivateResponse,
    });

    const responsePromise = dispatchFetch({
      url: "http://localhost:3000/private-avatar.png",
      method: "GET",
      destination: "image",
    });

    expect(responsePromise).toBeDefined();
    await responsePromise;
    await new Promise((r) => setTimeout(r, 10));
    expect(cachePutCalls).toHaveLength(0);
  });

  it("keeps /api/*, cross-origin, and non-GET requests strictly Network-Only", () => {
    const { dispatchFetch } = loadServiceWorker({
      fetchImpl: async () => new Response("ok"),
    });

    expect(
      dispatchFetch({
        url: "http://localhost:3000/api/finances/accounts",
        method: "GET",
      }),
    ).toBeUndefined();

    expect(
      dispatchFetch({
        url: "https://evil.example/script.js",
        method: "GET",
        destination: "script",
      }),
    ).toBeUndefined();

    expect(
      dispatchFetch({
        url: "http://localhost:3000/api/finances/transactions",
        method: "POST",
      }),
    ).toBeUndefined();
  });
});
