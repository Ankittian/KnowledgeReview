/**
 * card-worker.ts: runs the card generation jobs that admins queue in the app (Admin > Cards).
 *
 *   npm run cards:worker            keep running, one job at a time
 *   npm run cards:worker -- --once  run what is queued, then exit
 *
 * You normally do NOT need this: the web server starts the same worker by itself (instrumentation.ts). Use it when
 * the server runs with CARDS_WORKER=off, for example as a separate container.
 * It needs DATABASE_URL, the Claude credential (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN), KG_MCP_URL and
 * KG_MCP_TOKEN, exactly like the Knowledge Assistant. With CLAUDE_RUNNER=mock it writes canned cards instead.
 */
import "./_env";
import { createDb } from "@/db/client";
import { runWorker } from "@/lib/cards/generate/worker";

const once = process.argv.includes("--once");
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const h = createDb();
const stop = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => stop.abort());
runWorker(h.db, { log, once, signal: stop.signal })
  .catch((e) => {
    console.error("Card worker stopped:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => h.close());
