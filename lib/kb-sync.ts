import path from "node:path";
import type { DB } from "@/db/client";
import { buildCatalog } from "@/lib/cards/build";
import { loadKnowledgeBase } from "@/lib/cards/load";
import { audit } from "@/lib/events";
import { syncCatalog, type SyncReport } from "@/lib/sync";

export const kbDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.KB_DIR ?? "kb");

/** Load KB_DIR -> build cards -> upsert. Records the outcome in the audit log. */
export async function runKbSync(db: DB, opts: { actor: string | null; via: "cli" | "admin" }) {
  const dir = kbDir();
  const kb = loadKnowledgeBase(dir);
  const catalog = buildCatalog(kb);
  const report: SyncReport = await syncCatalog(db, catalog);
  await audit(db, opts.actor, "kb_sync", "kb", dir, {
    via: opts.via,
    warnings: catalog.warnings.length,
    quality: catalog.quality.map((q) => ({ type: q.entity.type, key: q.entity.key, yaml_file: q.yamlFile, field: q.field, issue: q.issue, text: q.text })),
    ...report,
  });
  return { report, warnings: catalog.warnings, quality: catalog.quality, kbDir: dir };
}
