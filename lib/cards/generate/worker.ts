import type { DB } from "@/db/client";
import { claimNextJob, finishJob, requeueInterrupted } from "./jobs";
import { processJob } from "./run";

/**
 * The card worker loop: takes queued jobs one at a time and runs them. Used by `npm run cards:worker` (a separate
 * process) and, by default, inside the web server itself (instrumentation.ts), so a queued job is always picked up.
 * Safe to run both at once: a job is claimed by exactly one of them.
 */
export interface WorkerOptions {
  log?: (m: string) => void;
  /** stop when the queue is empty instead of waiting for more */
  once?: boolean;
  signal?: AbortSignal;
  pollMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

export async function runWorker(db: DB, opts: WorkerOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const poll = opts.pollMs ?? (Number(process.env.CARDS_WORKER_POLL_MS) || 3000);
  // a job left 'generating' by a worker that died goes back in the queue (only once it is clearly stale)
  const back = await requeueInterrupted(db);
  if (back) log(`${back} interrupted job(s) put back in the queue`);
  log(`card worker started${opts.once ? " (once)" : ""}`);
  while (!opts.signal?.aborted) {
    let job;
    try {
      job = await claimNextJob(db);
    } catch (e) {
      log(`could not read the queue: ${e instanceof Error ? e.message : e}`);
      await sleep(poll * 2, opts.signal);
      continue;
    }
    if (!job) {
      if (opts.once) return;
      await sleep(poll, opts.signal);
      continue;
    }
    log(`job ${job.id}: started`);
    try {
      await processJob(db, job, undefined, log);
      log(`job ${job.id}: finished`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`job ${job.id}: failed: ${msg}`);
      await finishJob(db, job.id, "failed", { error: msg.slice(0, 500) });
    }
  }
}

const g = globalThis as unknown as { __cardWorker?: boolean };

/** Starts the worker inside this server process (once, even if the module is loaded again by hot reload). */
export async function startInlineWorker(): Promise<void> {
  if (g.__cardWorker) return;
  g.__cardWorker = true;
  const { getDb } = await import("@/db/client");
  const db = await getDb();
  void runWorker(db, { log: (m) => console.log(`[cards] ${m}`) }).catch((e) => {
    g.__cardWorker = false;
    console.error("[cards] worker stopped:", e instanceof Error ? e.message : e);
  });
}
