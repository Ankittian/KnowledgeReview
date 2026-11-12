import "./_env";
import fs from "node:fs";
import path from "node:path";
import { createDb, migrateDb } from "@/db/client";
import { loadNeedsChange, needsChangeMarkdown } from "@/lib/reports";

// Writes reports/needs-change.{jsonl,md}: what to fix in which YAML file / key / field.
const h = await createDb();
if (h.kind === "pglite") await migrateDb(h);
const rows = await loadNeedsChange(h.db);
const out = path.resolve("reports");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "needs-change.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
fs.writeFileSync(path.join(out, "needs-change.md"), needsChangeMarkdown(rows));
console.log(`${rows.length} flagged item(s) -> ${out}${path.sep}needs-change.{jsonl,md}`);
await h.close();
