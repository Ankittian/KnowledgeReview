/**
 * Runs once when the Next.js server starts. It starts the card generation worker inside the server, so jobs queued in
 * Admin > Cards are picked up without a second process. Set CARDS_WORKER=off to run `npm run cards:worker` instead
 * (for example as its own container).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (/^(off|false|0|no)$/i.test(process.env.CARDS_WORKER ?? "")) return;
  const { startInlineWorker } = await import("./lib/cards/generate/worker");
  await startInlineWorker();
}
