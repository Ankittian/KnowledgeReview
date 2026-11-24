import crypto from "node:crypto";

/**
 * Encrypts small secrets (the SMTP password) before they go into the database: AES-256-GCM with a key derived from a
 * server-side secret that lives only in the environment, never in Postgres. A database dump alone therefore cannot
 * reveal the stored password. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 *
 * Key: OTP_SECRET (else JWT_SECRET), 32+ characters. Changing it makes saved passwords unreadable; the admin then
 * re-enters the password once.
 */
function key(): Buffer {
  const s = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("OTP_SECRET (or JWT_SECRET) must be set to a random string of 32+ characters.");
  return crypto.createHash("sha256").update(`kr-settings-secret-box\n${s}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** The plain text, or null when the value is malformed or was encrypted with a different key. */
export function decryptSecret(boxed: string): string | null {
  try {
    const [v, iv, tag, ct] = boxed.split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
