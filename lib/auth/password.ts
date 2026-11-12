import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the username does not exist, so response time doesn't reveal valid usernames.
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password-placeholder"));
