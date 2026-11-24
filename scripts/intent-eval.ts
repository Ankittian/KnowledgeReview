/**
 * Evaluate the intent classifier (jev) against the labelled fixtures in tests/fixtures/intent/*.json.
 * Runs the REAL classifier (network, needs CLASSIFIER_API_KEY) with the layer forced on and in enforce mode, so a
 * "block" reflects the flags. Prints per-category precision/recall/F1, a confusion summary, latency p50/p95 and the
 * ids of misclassified cases. Costs API calls; nothing is written to the database.
 *
 *   npm run intent:eval -- [--file <name>] [--limit n] [--json]
 *   --file   only one fixture file (e.g. jailbreak or jailbreak.json)
 *   --limit  only the first n cases of each selected file
 *   --json   machine-readable output on stdout (the human report is suppressed)
 */
import "./_env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyIntent } from "@/lib/chat/intent";
import { intentConfig } from "@/lib/chat/intent/config";
import { INTENT_CATEGORIES, type IntentCategory, type IntentConfig, type IntentInput } from "@/lib/chat/intent/types";

const USAGE = `Usage: npm run intent:eval -- [--file <name>] [--limit n] [--json]
  --file   only one fixture file from tests/fixtures/intent (e.g. jailbreak)
  --limit  only the first n cases of each selected file
  --json   print the report as JSON
Needs CLASSIFIER_API_KEY (and optionally CLASSIFIER_MODEL / CLASSIFIER_BASE_URL / CLASSIFIER_THRESHOLDS / CLASSIFIER_TIMEOUT_MS).`;

const FIXTURE_DIR = join(process.cwd(), "tests", "fixtures", "intent");
const CONCURRENCY = 4;

type Label = IntentCategory | "allow";
type Predicted = Label | "error";
interface Fixture extends IntentInput {
  id: string;
  expected: Label;
  note?: string;
}
interface Row {
  id: string;
  file: string;
  expected: Label;
  predicted: Predicted;
  latencyMs: number;
  error?: string;
  scores: Partial<Record<IntentCategory, number>>;
}

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const fail = (msg: string, code = 2): never => {
  console.error(msg);
  process.exit(code);
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const asJson = args.includes("--json");
const fileArg = opt("--file");
const limitArg = opt("--limit");
const limit = limitArg === undefined ? undefined : Number(limitArg);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail(`--limit must be a positive integer.\n\n${USAGE}`);

if (!process.env.CLASSIFIER_API_KEY?.trim()) {
  fail("CLASSIFIER_API_KEY is not set (put it in .env or the environment). The eval calls the real jev API, so it cannot run without it.", 1);
}

function loadFixtures(): { file: string; cases: Fixture[] }[] {
  let names = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).sort();
  if (fileArg) {
    const want = fileArg.endsWith(".json") ? fileArg : `${fileArg}.json`;
    names = names.filter((f) => f === want);
    if (!names.length) fail(`No fixture file "${fileArg}" in tests/fixtures/intent.\n\n${USAGE}`);
  }
  return names.map((file) => {
    const cases = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as Fixture[];
    return { file, cases: limit ? cases.slice(0, limit) : cases };
  });
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);

async function main() {
  const config: IntentConfig = { ...intentConfig(), enabled: true, mode: "enforce" };
  const groups = loadFixtures();
  const all = groups.flatMap((g) => g.cases.map((c) => ({ file: g.file, c })));
  if (!asJson) console.error(`Classifying ${all.length} cases with ${config.model} (concurrency ${CONCURRENCY}, thresholds ${JSON.stringify(config.thresholds)})…`);

  let done = 0;
  const rows = await mapPool(all, CONCURRENCY, async ({ file, c }): Promise<Row> => {
    const { id, expected, note: _note, ...input } = c;
    const res = await classifyIntent(input, { config });
    done++;
    if (!asJson && done % 25 === 0) console.error(`  ${done}/${all.length}`);
    const predicted: Predicted = res.outcome === "error" ? "error" : res.block ? (res.category ?? "error") : "allow";
    return { id, file, expected, predicted, latencyMs: res.latencyMs, error: res.error, scores: res.scores };
  });

  const labels: Label[] = [...INTENT_CATEGORIES, "allow"];
  const columns: Predicted[] = [...labels, "error"];
  const confusion = Object.fromEntries(labels.map((l) => [l, Object.fromEntries(columns.map((p) => [p, 0]))])) as Record<Label, Record<Predicted, number>>;
  for (const r of rows) confusion[r.expected][r.predicted]++;

  const metrics = labels.map((l) => {
    const tp = confusion[l][l];
    const fp = labels.reduce((s, o) => s + (o === l ? 0 : confusion[o][l]), 0);
    const support = columns.reduce((s, p) => s + confusion[l][p], 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label: l, support, tp, fp, precision, recall, f1 };
  });
  const correct = rows.filter((r) => r.expected === r.predicted).length;
  const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const wrong = rows.filter((r) => r.expected !== r.predicted);
  const errors = rows.filter((r) => r.predicted === "error");

  if (asJson) {
    console.log(JSON.stringify({
      model: config.model, thresholds: config.thresholds, total: rows.length, correct, accuracy: rows.length ? correct / rows.length : 0,
      metrics, confusion, latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95) },
      errors: errors.length,
      misclassified: wrong.map(({ id, file, expected, predicted, error, scores }) => ({ id, file, expected, predicted, error, scores })),
    }, null, 2));
  } else {
    const w = 18;
    console.log(`\nModel ${config.model} — ${rows.length} cases, accuracy ${pct(rows.length ? correct / rows.length : 0).trim()} (${correct}/${rows.length}), classifier errors ${errors.length}\n`);
    console.log(`${"label".padEnd(w)}${"support".padStart(8)}${"precision".padStart(11)}${"recall".padStart(9)}${"F1".padStart(9)}`);
    for (const m of metrics) console.log(`${m.label.padEnd(w)}${String(m.support).padStart(8)}${pct(m.precision).padStart(11)}${pct(m.recall).padStart(9)}${pct(m.f1).padStart(9)}`);
    console.log(`\nConfusion (rows = expected, columns = predicted):`);
    console.log(`${"".padEnd(w)}${columns.map((c) => c.slice(0, 10).padStart(11)).join("")}`);
    for (const l of labels) console.log(`${l.padEnd(w)}${columns.map((p) => String(confusion[l][p]).padStart(11)).join("")}`);
    console.log(`\nLatency: p50 ${percentile(lat, 50)} ms, p95 ${percentile(lat, 95)} ms`);
    if (wrong.length) {
      console.log(`\nMisclassified (${wrong.length}):`);
      for (const r of wrong) {
        const s = Object.entries(r.scores).map(([k, v]) => `${k}=${(v ?? 0).toFixed(2)}`).join(" ");
        console.log(`  ${r.id.padEnd(10)} expected ${r.expected.padEnd(17)} got ${r.predicted.padEnd(17)} ${r.error ? `error=${r.error}` : s}`);
      }
    } else console.log(`\nNo misclassified cases.`);
  }
  process.exit(wrong.length ? 1 : 0);
}

main().catch((e) => fail(`intent:eval failed: ${e instanceof Error ? e.message : String(e)}`, 1));
