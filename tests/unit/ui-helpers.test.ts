import { describe, expect, it } from "vitest";
import {
  normalizeTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/ui/theme";
import {
  formatDate,
  formatMoney,
  formatPercent,
  getInitials,
  normalizeDecimalInput,
  toDateInputValue,
} from "@/lib/ui/format";
import {
  isNavItemActive,
  MOBILE_MORE_HREFS,
  MOBILE_PRIMARY_HREFS,
  NAV_ITEMS,
} from "@/lib/ui/navigation";
import { ApiClientError, parseApiResponse } from "@/lib/ui/api-client";

describe("UI Theme helpers (UI-01)", () => {
  it("normalizes theme values with DARK as default", () => {
    expect(normalizeTheme(undefined)).toBe("DARK");
    expect(normalizeTheme(null)).toBe("DARK");
    expect(normalizeTheme("")).toBe("DARK");
    expect(normalizeTheme("dark")).toBe("DARK");
    expect(normalizeTheme("DARK")).toBe("DARK");
    expect(normalizeTheme("invalid")).toBe("DARK");
    expect(normalizeTheme("light")).toBe("LIGHT");
    expect(normalizeTheme("LIGHT")).toBe("LIGHT");
    expect(normalizeTheme("  Light ")).toBe("LIGHT");
  });

  it("uses a storage key matching /theme/i and embeds safe pre-paint script", () => {
    expect(THEME_STORAGE_KEY).toMatch(/theme/i);
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain("data-theme");
    expect(THEME_INIT_SCRIPT).toContain("try{");
    expect(THEME_INIT_SCRIPT).toContain("catch(_)");
    // Catch block must remove "light" before adding "dark"
    const catchIdx = THEME_INIT_SCRIPT.indexOf("catch(_)");
    const catchBlock = THEME_INIT_SCRIPT.slice(catchIdx);
    expect(catchBlock).toContain('classList.remove("light")');
    expect(catchBlock).toContain('classList.add("dark")');
    // Must be valid JavaScript syntax
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow();
  });
});

describe("UI Formatting helpers", () => {
  it("formats Decimal(19,4) strings, negative balances, -0, and NaN cleanly", () => {
    expect(formatMoney("4250.0000", "USD")).toBe("$4,250.00");
    expect(formatMoney("-120.5000", "USD")).toBe("-$120.50");
    expect(formatMoney(0, "EUR")).toContain("0.00");
    expect(formatMoney(null, "USD")).toBe("$0.00");
    expect(formatMoney(-0, "USD")).toBe("$0.00");
    expect(formatMoney("-0.0000", "USD")).toBe("$0.00");
    expect(formatMoney(Number.NaN, "  eur ")).toBe("EUR 0.00");
  });

  it("formats percentages and dates safely", () => {
    expect(formatPercent(82.456)).toBe("82.5%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(null)).toBe("0%");

    expect(formatDate("2026-03-15T12:00:00.000Z")).toMatch(/2026/);
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(toDateInputValue("2026-03-15T12:00:00.000Z")).toBe("2026-03-15");
  });

  it("normalizes European/Spanish and English decimal inputs without 1000x corruption", () => {
    // European/Spanish inputs
    expect(normalizeDecimalInput("1.250,50")).toBe("1250.50");
    expect(normalizeDecimalInput("1.250,5")).toBe("1250.5");
    expect(normalizeDecimalInput("125,50")).toBe("125.50");
    expect(normalizeDecimalInput("0,125")).toBe("0.125");
    expect(normalizeDecimalInput("-0,125")).toBe("-0.125");
    expect(normalizeDecimalInput("1.250.000")).toBe("1250000");

    // English inputs
    expect(normalizeDecimalInput(" 1,250.75 ")).toBe("1250.75");
    expect(normalizeDecimalInput("1,250.50")).toBe("1250.50");
    expect(normalizeDecimalInput("1,000")).toBe("1000");
    expect(normalizeDecimalInput("1,250")).toBe("1250");
    expect(normalizeDecimalInput("10,500")).toBe("10500");
    expect(normalizeDecimalInput("1,250,000")).toBe("1250000");

    // Currency symbols, signs, whitespace
    expect(normalizeDecimalInput("$45.50")).toBe("45.50");
    expect(normalizeDecimalInput("EUR 1.250,50")).toBe("1250.50");
    expect(normalizeDecimalInput("-350.00")).toBe("-350.00");
    expect(normalizeDecimalInput("   ")).toBe("");
  });

  it("derives user initials from name or email including Unicode surrogate pairs", () => {
    expect(getInitials("Alejo Barrios", "a@example.com")).toBe("AB");
    expect(getInitials("Alejo", "a@example.com")).toBe("AL");
    expect(getInitials("", "owner@secondbrain.dev")).toBe("OW");
    expect(getInitials(null, null)).toBe("SB");
    expect(getInitials("🔥 Rocket")).toBe("🔥R");
  });
});

describe("Navigation metadata integrity (UI-02)", () => {
  it("contains all 9 protected Command Center routes", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(hrefs).toEqual([
      "/",
      "/accounts",
      "/transactions",
      "/inbox",
      "/transfers",
      "/budgets",
      "/categories",
      "/recurring",
      "/settings",
    ]);
  });

  it("partitions routes into 4 primary mobile slots + 5 More drawer routes", () => {
    expect(MOBILE_PRIMARY_HREFS).toHaveLength(4);
    expect(MOBILE_MORE_HREFS).toHaveLength(5);
    const combined = new Set([...MOBILE_PRIMARY_HREFS, ...MOBILE_MORE_HREFS]);
    expect(combined.size).toBe(NAV_ITEMS.length);
  });

  it("matches active routes accurately", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/accounts", "/")).toBe(false);
    expect(isNavItemActive("/accounts", "/accounts")).toBe(true);
    expect(isNavItemActive("/accounts/123", "/accounts")).toBe(true);
    expect(isNavItemActive("/transactions", "/accounts")).toBe(false);
  });
});

describe("API Client envelope unwrapper", () => {
  it("unwraps valid ok:true responses including pagination meta", async () => {
    const response = new Response(
      JSON.stringify({
        ok: true,
        data: [{ id: "1" }],
        meta: { total: 1, page: 1, pageSize: 25 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const parsed = await parseApiResponse<{ id: string }[]>(response);
    expect(parsed.data).toEqual([{ id: "1" }]);
    expect(parsed.meta).toEqual({ total: 1, page: 1, pageSize: 25 });
  });

  it("throws ApiClientError with code, message, and fieldErrors on failure", async () => {
    const response = new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid amount",
          fieldErrors: { amount: ["Must be positive"] },
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );

    await expect(parseApiResponse(response)).rejects.toThrow(ApiClientError);
    try {
      const response2 = new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Already confirmed",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
      await parseApiResponse(response2);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.status).toBe(409);
      expect(apiErr.code).toBe("CONFLICT");
      expect(apiErr.message).toBe("Already confirmed");
    }
  });
});
