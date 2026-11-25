import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_EXACT_PATHS = new Set([
  "/login",
  "/offline",
  "/api/health",
  "/api/auth",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
]);

const PUBLIC_PREFIXES = ["/api/auth/", "/icons/", "/_next/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) {
    return true;
  }
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isCronBearerRequest(request: NextRequest, pathname: string): boolean {
  if (
    request.method !== "POST" ||
    pathname !== "/api/finances/recurring/run"
  ) {
    return false;
  }
  const authHeader = request.headers.get("authorization");
  return Boolean(authHeader && /^Bearer\s+\S+/i.test(authHeader.trim()));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname) || isCronBearerRequest(request, pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required",
          },
        },
        { status: 401 },
      );
    }

    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
