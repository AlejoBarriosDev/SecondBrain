import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DIRECT_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    BETTER_AUTH_SECRET: z
      .string()
      .min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
    BETTER_AUTH_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().default("http://localhost:3000"),
    ),
    NEXT_PUBLIC_APP_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().default("http://localhost:3000"),
    ),
    ALLOWED_EMAIL: z
      .string()
      .trim()
      .email("ALLOWED_EMAIL must be a valid email address"),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    PASSKEY_RP_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("localhost"),
    ),
    PASSKEY_RP_NAME: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("SecondBrain"),
    ),
    PASSKEY_ORIGIN: z.preprocess(emptyToUndefined, z.string().url().optional()),
    LLM_PROVIDER: z.preprocess(
      emptyToUndefined,
      z.enum(["none", "openai", "gemini", "anthropic"]).default("none"),
    ),
    LLM_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    LLM_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
    NODE_ENV: z.preprocess(
      emptyToUndefined,
      z.enum(["development", "test", "production"]).default("development"),
    ),
  })
  .transform((data) => {
    const normalizedAuthUrl = data.BETTER_AUTH_URL.replace(/\/+$/, "");
    const normalizedAppUrl = data.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
    const normalizedPasskeyOrigin = (
      data.PASSKEY_ORIGIN ?? normalizedAuthUrl
    ).replace(/\/+$/, "");

    return {
      ...data,
      BETTER_AUTH_URL: normalizedAuthUrl,
      NEXT_PUBLIC_APP_URL: normalizedAppUrl,
      PASSKEY_ORIGIN: normalizedPasskeyOrigin,
      ALLOWED_EMAIL: data.ALLOWED_EMAIL.toLowerCase(),
    };
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): AppEnv {
  return envSchema.parse(source);
}

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
