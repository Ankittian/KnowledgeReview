// Load .env for CLI scripts (Next.js loads it on its own for the app).
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file absent */
  }
}
export {};
