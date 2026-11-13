import path from "node:path";
import type { DB } from "@/db/client";
import { buildCatalog } from "@/lib/cards/build";
import { loadKnowledgeBase } from "@/lib/cards/load";
import { audit } from "@/lib/events";
import { syncCatalog, type SyncReport } from "@/lib/sync";

export const kbDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.KB_DIR ?? "kb");

/**
 * Load KB_DIR -> build cards -> upsert. Records the outcome in the audit log.
 * entitiesOnly: load only the KB items (modules, concepts, rules, processes, forms) and skip the YAML template cards.
 * Used on a fresh deployment, where the flashcards come from the generated catalogs (npm run cards:push).
 */
export async function runKbSync(db: DB, opts: { actor: string | null; via: "cli" | "admin"; entitiesOnly?: boolean }) {
  const dir = kbDir();
  const kb = loadKnowledgeBase(dir);
  const built = buildCatalog(kb);
  const catalog = opts.entitiesOnly ? { ...built, cards: [] } : built;
  const report: SyncReport = await syncCatalog(db, catalog);
  await audit(db, opts.actor, "kb_sync", "kb", dir, {
    via: opts.via,
    warnings: catalog.warnings.length,
    quality: catalog.quality.map((q) => ({ type: q.entity.type, key: q.entity.key, yaml_file: q.yamlFile, field: q.field, issue: q.issue, text: q.text })),
    ...report,
  });
  return { report, warnings: catalog.warnings, quality: catalog.quality, kbDir: dir };
}
