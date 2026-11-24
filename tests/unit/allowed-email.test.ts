import { describe, expect, it } from "vitest";
import { APIError } from "better-auth/api";
import { assertAllowedEmail, isAllowedEmail } from "@/lib/auth/allowed-email";

describe("ALLOWED_EMAIL fail-closed guards", () => {
  it("matches case-insensitively and trims whitespace", () => {
    expect(isAllowedEmail("owner@example.com", "owner@example.com")).toBe(true);
    expect(isAllowedEmail("  OWNER@Example.COM ", "owner@example.com")).toBe(
      true,
    );
    expect(() =>
      assertAllowedEmail("OWNER@Example.COM", "  owner@example.com  "),
    ).not.toThrow();
  });

  it("fails closed when ALLOWED_EMAIL is unset or blank", () => {
    expect(isAllowedEmail("owner@example.com", undefined)).toBe(false);
    expect(isAllowedEmail("owner@example.com", "")).toBe(false);
    expect(isAllowedEmail("owner@example.com", "   ")).toBe(false);
  });

  it("fails closed when candidate email is missing or mismatched", () => {
    expect(isAllowedEmail(undefined, "owner@example.com")).toBe(false);
    expect(isAllowedEmail(null, "owner@example.com")).toBe(false);
    expect(isAllowedEmail("", "owner@example.com")).toBe(false);
    expect(isAllowedEmail("intruder@example.com", "owner@example.com")).toBe(
      false,
    );
  });

  it("throws BetterAuth APIError FORBIDDEN on unauthorized email", () => {
    let caught: unknown;
    try {
      assertAllowedEmail("intruder@example.com", "owner@example.com");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe("FORBIDDEN");
  });
});
