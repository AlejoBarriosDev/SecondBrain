/**
 * Isolated BetterAuth test instance with `testUtils()` plugin.
 * NEVER import this file anywhere inside `src/`.
 * Intentionally omits `nextCookies()` so it runs cleanly inside Vitest and Playwright.
 *
 * Uses native ESM dynamic `import()` for `better-auth` packages so Playwright's
 * CommonJS TypeScript loader on Node 22 does not hit `require(esm)` linking errors.
 */
import type { TestHelpers } from "better-auth/plugins";
import { prisma } from "../../src/lib/db/prisma";
import { seedUserDefaults } from "../../src/modules/core/seed-defaults";

async function loadEsmModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return (await import(specifier)) as T;
  }
  const nativeImport = new Function(
    "s",
    "return import(s)",
  ) as (s: string) => Promise<T>;
  return nativeImport(specifier);
}

function isAllowedEmailForTest(email?: string | null): boolean {
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  const candidate = email?.trim().toLowerCase();
  if (!allowed || !candidate) {
    return false;
  }
  return candidate === allowed;
}

let cachedHelpersPromise: Promise<TestHelpers> | null = null;

async function createTestAuthHelpers(): Promise<TestHelpers> {
  const [
    { betterAuth },
    { prismaAdapter },
    { testUtils },
    { APIError },
    { passkey },
  ] = await Promise.all([
    loadEsmModule<typeof import("better-auth")>("better-auth"),
    loadEsmModule<typeof import("better-auth/adapters/prisma")>(
      "better-auth/adapters/prisma",
    ),
    loadEsmModule<typeof import("better-auth/plugins")>("better-auth/plugins"),
    loadEsmModule<typeof import("better-auth/api")>("better-auth/api"),
    loadEsmModule<typeof import("@better-auth/passkey")>(
      "@better-auth/passkey",
    ),
  ]);

  const assertAllowed = (email?: string | null): void => {
    if (!isAllowedEmailForTest(email)) {
      throw new APIError("FORBIDDEN", {
        message: "Access restricted to authorized account.",
      });
    }
  };

  const baseURL = (
    process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000"
  ).replace(/\/+$/, "");

  const authInstance = betterAuth({
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    secret:
      process.env.BETTER_AUTH_SECRET ||
      "test-secondbrain-secret-key-at-least-32-characters-long",
    baseURL,
    advanced: {
      database: {
        joins: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            assertAllowed(user.email);
            return { data: user };
          },
          after: async (user) => {
            await seedUserDefaults(prisma, user.id);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { email: true },
            });
            assertAllowed(user?.email);
            return { data: session };
          },
        },
      },
    },
    plugins: [
      passkey({
        rpID: process.env.PASSKEY_RP_ID?.trim() || "localhost",
        rpName: process.env.PASSKEY_RP_NAME?.trim() || "SecondBrain",
        origin: (process.env.PASSKEY_ORIGIN?.trim() || baseURL).replace(
          /\/+$/,
          "",
        ),
      }),
      testUtils(),
    ],
  });

  const ctx = await authInstance.$context;
  return ctx.test;
}

export async function getTestAuthHelpers(): Promise<TestHelpers> {
  if (!cachedHelpersPromise) {
    cachedHelpersPromise = createTestAuthHelpers().catch((err) => {
      cachedHelpersPromise = null;
      throw err;
    });
  }
  return cachedHelpersPromise;
}
