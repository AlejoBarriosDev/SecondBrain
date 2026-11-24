import { APIError } from "better-auth/api";

/**
 * Fail-closed check against ALLOWED_EMAIL.
 * Returns false if ALLOWED_EMAIL is unset/blank or if email is missing/mismatched.
 */
export function isAllowedEmail(
  email?: string | null,
  allowedEmailEnv: string | undefined = process.env.ALLOWED_EMAIL,
): boolean {
  const allowed = allowedEmailEnv?.trim().toLowerCase();
  const candidate = email?.trim().toLowerCase();

  if (!allowed || !candidate) {
    return false;
  }

  return candidate === allowed;
}

/**
 * Throws a BetterAuth APIError("FORBIDDEN") if email does not match ALLOWED_EMAIL.
 */
export function assertAllowedEmail(
  email?: string | null,
  allowedEmailEnv: string | undefined = process.env.ALLOWED_EMAIL,
): void {
  if (!isAllowedEmail(email, allowedEmailEnv)) {
    throw new APIError("FORBIDDEN", {
      message: "Access restricted to authorized account.",
    });
  }
}
