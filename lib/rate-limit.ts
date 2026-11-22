/**
 * Small in-memory sliding-window limiter, per process. Good enough to stop one signed-in user flooding an endpoint;
 * with several app instances each keeps its own count, so the effective limit is `limit` x instances.
 */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); // keep memory bounded
  return false;
}
