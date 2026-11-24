import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { passkey } from "@better-auth/passkey";
import { prisma } from "@/lib/db/prisma";
import { assertAllowedEmail } from "@/lib/auth/allowed-email";
import { seedUserDefaults } from "@/modules/core/seed-defaults";

function getAuthConfigEnv() {
  const baseURL = (
    process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000"
  ).replace(/\/+$/, "");
  const appURL = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || baseURL
  ).replace(/\/+$/, "");
  const passkeyOrigin = (
    process.env.PASSKEY_ORIGIN?.trim() || baseURL
  ).replace(/\/+$/, "");

  return {
    secret:
      process.env.BETTER_AUTH_SECRET ||
      "build-time-placeholder-secret-replace-at-runtime",
    baseURL,
    trustedOrigins: [...new Set([baseURL, appURL])],
    googleClientId:
      process.env.GOOGLE_CLIENT_ID || "placeholder-google-client-id",
    googleClientSecret:
      process.env.GOOGLE_CLIENT_SECRET || "placeholder-google-client-secret",
    rpID: process.env.PASSKEY_RP_ID?.trim() || "localhost",
    rpName: process.env.PASSKEY_RP_NAME?.trim() || "SecondBrain",
    passkeyOrigin,
  };
}

const config = getAuthConfigEnv();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: config.secret,
  baseURL: config.baseURL,
  trustedOrigins: config.trustedOrigins,
  advanced: {
    database: {
      joins: true,
    },
  },
  socialProviders: {
    google: {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      accessType: "offline",
      prompt: "select_account consent",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
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
      rpID: config.rpID,
      rpName: config.rpName,
      origin: config.passkeyOrigin,
    }),
    nextCookies(),
  ],
});

export type AuthInstance = typeof auth;
