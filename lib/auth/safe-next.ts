/**
 * Post-login redirect target. Only same-origin absolute paths are allowed.
 * Browsers treat `\` as `/`, so `/\evil.com` would become `//evil.com`; control characters are also stripped by
 * browsers inside URLs, so they are rejected too.
 */
export function safeNext(next: unknown, fallback = "/chat"): string {
  if (typeof next !== "string" || !/^\/(?![/\\])/.test(next)) return fallback;
  if (/[\\\x00-\x1f\x7f]/.test(next)) return fallback;
  try {
    const base = "http://localhost";
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
