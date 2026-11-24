import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { isAllowedEmail } from "@/lib/auth/allowed-email";
import { ForbiddenError, UnauthorizedError } from "@/lib/api/errors";

export interface AuthenticatedSession {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}

/**
 * Verifies the BetterAuth session AND ALLOWED_EMAIL for API Route Handlers and Server Actions.
 * Accepts optional requestHeaders so route handlers and tests can pass req.headers directly.
 */
export async function requireSession(
  requestHeaders?: Headers,
): Promise<AuthenticatedSession> {
  const hdrs = requestHeaders ?? (await headers());
  const result = await auth.api.getSession({ headers: hdrs });

  if (!result?.user || !result?.session) {
    throw new UnauthorizedError("Authentication required");
  }

  if (!isAllowedEmail(result.user.email)) {
    throw new ForbiddenError("Access restricted to authorized account.");
  }

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image ?? null,
    },
    session: {
      id: result.session.id,
      userId: result.session.userId,
      token: result.session.token,
      expiresAt: result.session.expiresAt,
      ipAddress: result.session.ipAddress ?? null,
      userAgent: result.session.userAgent ?? null,
    },
  };
}

/**
 * Verifies the BetterAuth session AND ALLOWED_EMAIL for React Server Components.
 * Redirects to /login when unauthenticated or unauthorized.
 */
export async function requirePageSession(): Promise<AuthenticatedSession> {
  try {
    return await requireSession();
  } catch {
    redirect("/login");
  }
}
