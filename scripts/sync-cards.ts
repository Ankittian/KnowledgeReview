import "./_env";
import { createDb } from "@/db/client";
import { runKbSync } from "@/lib/kb-sync";

const h = createDb();
// --entities-only: load the KB items but not the YAML template cards (fresh deployments; cards come from cards:push).
const { report, warnings, quality, kbDir } = await runKbSync(h.db, { actor: null, via: "cli", entitiesOnly: process.argv.includes("--entities-only") });
console.log(`KB: ${kbDir}`);
if (warnings.length) console.warn(`${warnings.length} warning(s):\n  ${warnings.slice(0, 30).join("\n  ")}`);
if (quality.length) {
  console.warn(`${quality.length} data-quality finding(s) in the YAML (cards still issued so reviewers can fix them):`);
  for (const q of quality) console.warn(`  [${q.issue}] ${q.yamlFile} -> ${q.entity.key} -> ${q.field}`);
}
console.log(JSON.stringify(report, null, 2));
console.log(report.changed ? "Sync applied changes." : "No changes (already in sync).");
await h.close();
