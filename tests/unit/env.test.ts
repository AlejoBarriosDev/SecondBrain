import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const VALID_MINIMAL_ENV = {
  DATABASE_URL: "postgresql://secondbrain:secondbrain@localhost:5432/secondbrain",
  BETTER_AUTH_SECRET: "super-secret-value-at-least-16-chars",
  ALLOWED_EMAIL: "  Owner@SecondBrain.Local  ",
};

describe("Environment validation (src/lib/env.ts)", () => {
  it("parses a minimal valid env and applies defaults + normalization", () => {
    const env = parseEnv(VALID_MINIMAL_ENV);

    expect(env.DATABASE_URL).toBe(VALID_MINIMAL_ENV.DATABASE_URL);
    expect(env.ALLOWED_EMAIL).toBe("owner@secondbrain.local");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.PASSKEY_RP_ID).toBe("localhost");
    expect(env.PASSKEY_RP_NAME).toBe("SecondBrain");
    expect(env.PASSKEY_ORIGIN).toBe("http://localhost:3000");
    expect(env.LLM_PROVIDER).toBe("none");
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces empty-string optional URLs to undefined and trims trailing slashes", () => {
    const env = parseEnv({
      ...VALID_MINIMAL_ENV,
      BETTER_AUTH_URL: "https://brain.example.com/",
      NEXT_PUBLIC_APP_URL: "https://brain.example.com///",
      DIRECT_URL: "",
      PASSKEY_ORIGIN: "",
      LLM_BASE_URL: "",
      LLM_API_KEY: "",
    });

    expect(env.BETTER_AUTH_URL).toBe("https://brain.example.com");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://brain.example.com");
    expect(env.PASSKEY_ORIGIN).toBe("https://brain.example.com");
    expect(env.DIRECT_URL).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
    expect(env.LLM_API_KEY).toBeUndefined();
  });

  it("rejects missing required variables", () => {
    expect(() => parseEnv({})).toThrow();
    expect(() =>
      parseEnv({
        ...VALID_MINIMAL_ENV,
        DATABASE_URL: "",
      }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...VALID_MINIMAL_ENV,
        BETTER_AUTH_SECRET: "too-short",
      }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...VALID_MINIMAL_ENV,
        ALLOWED_EMAIL: "not-an-email",
      }),
    ).toThrow();
  });

  it("rejects invalid LLM_PROVIDER values", () => {
    expect(() =>
      parseEnv({
        ...VALID_MINIMAL_ENV,
        LLM_PROVIDER: "unsupported-provider",
      }),
    ).toThrow();
  });
});
