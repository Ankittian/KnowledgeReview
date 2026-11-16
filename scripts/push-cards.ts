/**
 * push-cards.ts: pushes generated flashcard catalogs (JSON) into Postgres.
 *
 *   npm run cards:push                                   append every data/generated-cards/*.json
 *   npm run cards:push -- data/generated-cards/MM.forms-common.functional.json   append one file
 *   npm run cards:push -- --mode purge                   replace the module's cards (see below)
 *   npm run cards:push -- --mode purge --scope module    replace every card of the module, legacy ones too
 *   npm run cards:push -- --dry-run                      do everything, report, roll back
 *   npm run cards:push -- --allow-duplicates             only warn about new cards whose title repeats a stored one
 *   npm run cards:push -- --no-revisions                 refuse when a card would be replaced by a new version
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
import {
  cardSummary,
  countCards,
  DEFAULT_PUSH_OPTIONS,
  loadCatalog,
  pushCatalog,
  PushRefused,
  resolveCatalogFiles,
  type PurgeScope,
  type PushMode,
  type PushResult,
} from "@/lib/cards/push";

const HELP = `Usage: npm run cards:push -- [files...] [--mode append|purge] [--scope audience|module] [--dry-run]
                                  [--allow-duplicates] [--similarity 0.6] [--no-duplicate-check] [--no-revisions]

  files       catalog JSON files (default: every *.json in data/generated-cards/)
  --mode      append (default) | purge. --append and --purge are shorthands.
  --scope     with purge: audience (default, the catalog's module + audience) | module (all cards of the module)
  --dry-run   run in a transaction and roll back, only report what would change
  --allow-duplicates    a new card whose title is too close to a stored card of the same item is reported, not refused
  --similarity N        how close two titles must be (0 to 1, default 0.6) to count as the same topic
  --no-duplicate-check  skip the title comparison entirely
  --no-revisions        refuse the push if a card already exists with different text (it would get a new version)`;

interface Cli {
  files: string[];
  mode: PushMode;
  scope: PurgeScope;
  dryRun: boolean;
  duplicates: "error" | "warn" | "off";
  similarity: number;
  allowRevisions: boolean;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    files: [],
    mode: "append",
    scope: "audience",
    dryRun: false,
    duplicates: DEFAULT_PUSH_OPTIONS.duplicates,
    similarity: DEFAULT_PUSH_OPTIONS.similarity,
    allowRevisions: DEFAULT_PUSH_OPTIONS.allowRevisions,
  };
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
    else if (a === "--allow-duplicates") cli.duplicates = "warn";
    else if (a === "--no-duplicate-check") cli.duplicates = "off";
    else if (a === "--no-revisions") cli.allowRevisions = false;
    else if (a === "--similarity" || a.startsWith("--similarity=")) {
      const v = Number(value("--similarity"));
      if (!(v > 0 && v <= 1)) fail("--similarity must be a number above 0 and up to 1");
      cli.similarity = v;
    }
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

const MAX_SHOWN = 20;

/** Prints what the push found besides the counts: similar titles, revised cards and refs that matched no KB item. */
function report(r: PushResult, cli: Cli) {
  if (r.revisions.length) {
    console.log(`\n  ${r.revisions.length} card(s) already exist with different text and ${cli.dryRun ? "would get" : "got"} a new version:`);
    for (const c of r.revisions.slice(0, MAX_SHOWN)) console.log(`    ${c.id}`);
    if (r.revisions.length > MAX_SHOWN) console.log(`    ... and ${r.revisions.length - MAX_SHOWN} more`);
  }
  if (r.similar.length) {
    console.log(`\n  ${r.similar.length} new card(s) look like a topic that is already taught (similarity from ${cli.similarity}):`);
    for (const p of r.similar.slice(0, MAX_SHOWN)) {
      console.log(`    [${p.item}] ${p.score}  NEW (${p.newLevel}): ${p.newTitle}`);
      console.log(`                    ${p.existing ? "STORED" : "IN FILE"} (${p.otherLevel}): ${p.otherTitle}`);
    }
    if (r.similar.length > MAX_SHOWN) console.log(`    ... and ${r.similar.length - MAX_SHOWN} more`);
  }
  if (r.unresolvedRefs.length) {
    console.log(`\n  ${r.unresolvedRefs.length} source_refs matched no knowledge-base item (the card has no link to them):`);
    for (const u of r.unresolvedRefs.slice(0, MAX_SHOWN)) console.log(`    [${u.item}] ${u.topicKey}: ${u.ref}`);
    if (r.unresolvedRefs.length > MAX_SHOWN) console.log(`    ... and ${r.unresolvedRefs.length - MAX_SHOWN} more`);
    console.log(`    Run npm run cards:sync -- --entities-only if the KB is not loaded, or fix the path or key.`);
  }
}

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
      let r: PushResult;
      try {
        r = await pushCatalog(h.db, catalog, {
          mode: cli.mode,
          purgeScope: cli.scope,
          dryRun: cli.dryRun,
          duplicates: cli.duplicates,
          similarity: cli.similarity,
          allowRevisions: cli.allowRevisions,
        });
      } catch (e) {
        if (e instanceof PushRefused) {
          console.error(`\nPush refused for ${file}: ${e.message}. Nothing was saved.`);
          for (const p of e.similar.slice(0, MAX_SHOWN)) {
            console.error(`  [${p.item}] ${p.score}  NEW (${p.newLevel}): ${p.newTitle}`);
            console.error(`                  ${p.existing ? "STORED" : "IN FILE"} (${p.otherLevel}): ${p.otherTitle}`);
          }
          for (const c of e.revisions.slice(0, MAX_SHOWN)) console.error(`  revised: ${c.id}`);
          console.error(`  Remove or reword the cards, or use --allow-duplicates / drop --no-revisions to push anyway.`);
          process.exit(1);
        }
        throw e;
      }
      console.log(`${catalog.module}: ${cli.dryRun ? "would be " : ""}${line(r)}.`);
      report(r, cli);
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
