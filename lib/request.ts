import { headers } from "next/headers";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return { ip: (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null, userAgent: h.get("user-agent") };
}

/** CSRF guard for JSON route handlers: the Origin must match the host serving the request. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
