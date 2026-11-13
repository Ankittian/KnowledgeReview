/**
 * push-cards.ts: pushes generated flashcard catalogs (JSON) into Postgres.
 *
 *   npm run cards:push                                   append every data/generated-cards/*.json
 *   npm run cards:push -- MM.functional.json             append one file
 *   npm run cards:push -- --mode purge                   replace the module's cards (see below)
 *   npm run cards:push -- --mode purge --scope module    replace every card of the module, legacy ones too
 *   npm run cards:push -- --dry-run                      do everything, report, roll back
 *
 * Modes
 *   append (default)  adds new cards, adds a new version to a card whose text changed, leaves the rest and all review
 *                     history untouched. Safe to run repeatedly.
 *   purge             first deletes the existing cards of the catalog's module and audience (--scope module: the whole
 *                     module) together with their reviews, feedback, deck entries and schedule, then inserts the catalog.
 *
 * Each file is pushed in one transaction. The work lives in lib/cards/push/ (catalog, purge, kb-items, cards, index).
 * The knowledge base must already be loaded (npm run cards:sync) for `source_refs` to resolve into links.
 */
import "./_env";
import fs from "node:fs";
import path from "node:path";
import { createDb } from "@/db/client";
import { cardSummary, countCards, loadCatalog, pushCatalog, resolveCatalogFiles, type PurgeScope, type PushMode, type PushResult } from "@/lib/cards/push";

const HELP = `Usage: npm run cards:push -- [files...] [--mode append|purge] [--scope audience|module] [--dry-run]

  files       catalog JSON files (default: every *.json in data/generated-cards/)
  --mode      append (default) | purge. --append and --purge are shorthands.
  --scope     with purge: audience (default, the catalog's module + audience) | module (all cards of the module)
  --dry-run   run in a transaction and roll back, only report what would change`;

interface Cli {
  files: string[];
  mode: PushMode;
  scope: PurgeScope;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { files: [], mode: "append", scope: "audience", dryRun: false };
  const fail = (m: string): never => {
    console.error(`${m}\n\n${HELP}`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (name: string) => (a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[++i] ?? fail(`${name} needs a value`)));
    if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--purge") cli.mode = "purge";
    else if (a === "--append") cli.mode = "append";
    else if (a === "--dry-run") cli.dryRun = true;
    else if (a === "--mode" || a.startsWith("--mode=")) {
      const v = value("--mode");
      if (v !== "append" && v !== "purge") fail(`--mode must be append or purge, got "${v}"`);
      cli.mode = v as PushMode;
    } else if (a === "--scope" || a.startsWith("--scope=")) {
      const v = value("--scope");
      if (v !== "audience" && v !== "module") fail(`--scope must be audience or module, got "${v}"`);
      cli.scope = v as PurgeScope;
    } else if (a.startsWith("--")) fail(`Unknown option ${a}`);
    else cli.files.push(a);
  }
  return cli;
}

const line = (r: PushResult) =>
  [
    r.mode === "purge" ? `purged ${r.purged}` : null,
    `${r.cardsInserted} new`,
    `${r.cardsNewVersion} updated (new version)`,
    `${r.cardsUnchanged} unchanged`,
    `${r.linksInserted} knowledge links`,
    r.kbItemsCreated ? `${r.kbItemsCreated} kb items created` : null,
  ]
    .filter(Boolean)
    .join(", ");

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const requested = resolveCatalogFiles(cli.files);
  const files = requested.filter((f) => {
    const ok = fs.existsSync(path.resolve(f));
    if (!ok) console.warn(`File not found: ${path.resolve(f)}, skipping.`);
    return ok;
  });
  if (files.length === 0) {
    console.error("No JSON card catalog files found to process.");
    process.exit(1);
  }

  // Read and validate every file before touching the database.
  const catalogs = files.map((file) => ({ file, catalog: loadCatalog(file) }));

  const h = createDb();
  console.log(
    `Connecting to Postgres (DATABASE_URL)... mode: ${cli.mode}${cli.mode === "purge" ? ` (scope: ${cli.scope})` : ""}${cli.dryRun ? " | DRY RUN, nothing is saved" : ""}`,
  );

  try {
    for (const { file, catalog } of catalogs) {
      console.log(`\n========================================================`);
      console.log(`Processing: ${file}`);
      console.log(`Module: ${catalog.module} | Audience: ${catalog.audience} | Total Cards: ${countCards(catalog)}`);
      const r = await pushCatalog(h.db, catalog, { mode: cli.mode, purgeScope: cli.scope, dryRun: cli.dryRun });
      console.log(`${catalog.module}: ${cli.dryRun ? "would be " : ""}${line(r)}.`);
    }

    console.log(`\n========================================================`);
    console.log(`DATABASE SUMMARY${cli.dryRun ? " (unchanged, dry run)" : ""}:`);
    const s = await cardSummary(h.db);
    console.table(s.byGroup);
    console.log(`Total Active Cards: ${s.activeCards} | card_health rows: ${s.healthRows}`);
  } finally {
    await h.close();
  }
}

main().catch((err) => {
  console.error("Error pushing cards:", err instanceof Error ? err.message : err);
  process.exit(1);
});
