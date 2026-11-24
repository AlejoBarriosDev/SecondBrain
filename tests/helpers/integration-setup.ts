import dotenv from "dotenv";

// Load .env first without overwriting explicit shell vars
dotenv.config();

// Force integration tests onto the isolated secondbrain_test database
const testDbUrl =
  process.env.DATABASE_URL_TEST ||
  "postgresql://secondbrain:secondbrain@localhost:5432/secondbrain_test?schema=public";

if (!testDbUrl.includes("_test")) {
  throw new Error(
    `Refusing to run integration tests against non-test database URL: ${testDbUrl}`,
  );
}

process.env.DATABASE_URL = testDbUrl;
process.env.DIRECT_URL = testDbUrl;
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ||
  "test-secondbrain-secret-key-at-least-32-characters-long";
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL || "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
process.env.ALLOWED_EMAIL =
  process.env.ALLOWED_EMAIL || "owner@secondbrain.local";
process.env.PASSKEY_RP_ID = process.env.PASSKEY_RP_ID || "localhost";
process.env.PASSKEY_RP_NAME = process.env.PASSKEY_RP_NAME || "SecondBrain";
process.env.PASSKEY_ORIGIN =
  process.env.PASSKEY_ORIGIN || "http://localhost:3000";
