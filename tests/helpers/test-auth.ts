/**
 * Isolated BetterAuth test instance with `testUtils()` plugin.
 * NEVER import this file anywhere inside `src/`.
 * Intentionally omits `nextCookies()` so it runs cleanly inside Vitest and Playwright globalSetup.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { testUtils } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "@/lib/db/prisma";
import { assertAllowedEmail } from "@/lib/auth/allowed-email";
import { seedUserDefaults } from "@/modules/core/seed-defaults";

const baseURL = (
  process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000"
).replace(/\/+$/, "");

export const testAuth = betterAuth({
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
          assertAllowedEmail(user.email);
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
          assertAllowedEmail(user?.email);
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

export async function getTestAuthHelpers() {
  const ctx = await testAuth.$context;
  return ctx.test;
}
