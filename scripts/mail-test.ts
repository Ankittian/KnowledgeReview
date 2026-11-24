import "./_env";
import { getDb } from "@/db/client";
import { mailFrom, sendMailWith } from "@/lib/mail";
import { renderTestMail } from "@/lib/mail";
import { resolveMailConfig } from "@/lib/mail-settings";

// Sends one test email through the ACTIVE connection saved under Admin > Settings & exports > Email:
//   npm run mail:test -- you@example.com
// On EC2:  docker compose --profile app run --rm init npx tsx scripts/mail-test.ts you@example.com
const to = process.argv[2];
if (!to) {
  console.error("Usage: npm run mail:test -- <recipient email>");
  process.exit(1);
}
const cfg = await resolveMailConfig(await getDb());
if (cfg.source === "none") {
  console.error("No active email connection: add one under Admin > Settings & exports > Email and press Use.");
  process.exit(1);
}
console.log(`Using the saved connection "${cfg.name}": ${cfg.host}:${cfg.port} as ${cfg.user ?? "(no login)"}, from ${mailFrom(cfg)}`);
try {
  const { subject, text, html } = renderTestMail(false);
  await sendMailWith(cfg, { to, subject, text, html });
  console.log(`Sent to ${to}. Check the inbox (and spam).`);
  process.exit(0);
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
}
