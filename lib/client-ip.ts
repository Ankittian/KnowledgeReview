/**
 * Client IP for throttling and the activity log.
 *
 * X-Forwarded-For and X-Real-IP are plain request headers: when the app is reached directly, a client can put anything
 * in them. So they are only believed when TRUSTED_PROXY=true, i.e. when the app sits behind a reverse proxy (the nginx
 * in infra/nginx) that overwrites X-Real-IP and appends the real peer address to the END of X-Forwarded-For.
 * Without it the IP is unknown (null) and the per-IP limits do not apply, rather than being trivially bypassable.
 */
export function clientIp(get: (name: string) => string | null, env: Record<string, string | undefined> = process.env): string | null {
  if (env.TRUSTED_PROXY !== "true") return null;
  const real = get("x-real-ip")?.trim();
  if (real) return real;
  const hops = get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.length ? hops[hops.length - 1] : null; // last hop = appended by our proxy; earlier ones are client-supplied
}
