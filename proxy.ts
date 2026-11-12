import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { rotateRefreshToken } from "@/lib/auth/refresh";
import { ACCESS_COOKIE, accessCookie, clearedCookie, REFRESH_COOKIE, refreshCookie, verifyAccessToken } from "@/lib/auth/tokens";

/**
 * Keeps logins alive. Server components can only read cookies, so renewal happens here:
 *  - valid access token: pass through (no database call);
 *  - access token missing/expired but a refresh token present: rotate it, hand the new access token to this very
 *    request, and set the new cookies on the response;
 *  - refresh fails (expired, reused, user disabled): clear both cookies. Pages then redirect to /login, APIs return 401.
 * It never blocks a request itself: access control stays in requireUser / requireRole / the route handlers.
 */
export async function proxy(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh && !access) return NextResponse.next();
  if (access && (await verifyAccessToken(access))) return NextResponse.next();
  if (!refresh) {
    const res = NextResponse.next();
    res.cookies.set(clearedCookie(ACCESS_COOKIE));
    return res;
  }

  const fwd = req.headers.get("x-forwarded-for");
  const result = await rotateRefreshToken(await getDb(), refresh, {
    ip: (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip")) || null,
    userAgent: req.headers.get("user-agent"),
  });

  if (!result.ok) {
    req.cookies.delete(ACCESS_COOKIE);
    req.cookies.delete(REFRESH_COOKIE);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set(clearedCookie(ACCESS_COOKIE));
    res.cookies.set(clearedCookie(REFRESH_COOKIE));
    return res;
  }

  // Make the renewed access token visible to the page / route handler handling this same request.
  req.cookies.set(ACCESS_COOKIE, result.access);
  if (result.refresh) req.cookies.set(REFRESH_COOKIE, result.refresh.token);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(accessCookie(result.access));
  if (result.refresh) res.cookies.set(refreshCookie(result.refresh.token, result.refresh.expires));
  return res;
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
