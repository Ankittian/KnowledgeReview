/**
 * export-ledger.ts: prints the coverage ledger the card-generation prompt needs, from the database.
 *
 *   npm run cards:ledger -- --module MM                       every generated card of the module, functional set
 *   npm run cards:ledger -- --module MM --audience technical  the technical set
 *   npm run cards:ledger -- --module MM --items fGRN,fGateEntry   only these items (use for a run on a few forms)
 *   npm run cards:ledger -- --module MM --out ledger.txt      write to a file instead of the screen
 *
 * One line per active card:  <item key> | <level> | <topic_key> | <title>
 * Only the title (the first line of the card front) is exported, never the body: the next run decides what is already
 * taught from the titles alone. Paste the output into {{EXISTING_CARDS}} of docs/prompts/prompt5.txt.
 */
import "./_env";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb } from "@/db/client";

const HELP = `Usage: npm run cards:ledger -- --module MM [--audience functional|technical] [--items key1,key2] [--out file]`;

function parseArgs(argv: string[]) {
  const o: { module: string; audience: "functional" | "technical"; items: string[]; out: string } = { module: "", audience: "functional", items: [], out: "" };
  const fail = (m: string): never => {
    console.error(`${m}\n\n${HELP}`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => (a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[++i] ?? fail(`${a} needs a value`)));
    if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--module" || a.startsWith("--module=")) o.module = value().trim();
    else if (a === "--audience" || a.startsWith("--audience=")) {
      const v = value();
      if (v !== "functional" && v !== "technical") fail(`--audience must be functional or technical, got "${v}"`);
      o.audience = v as "functional" | "technical";
    } else if (a === "--items" || a.startsWith("--items=")) o.items = value().split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--out" || a.startsWith("--out=")) o.out = value();
    else fail(`Unknown option ${a}`);
  }
  if (!o.module) fail("--module is required");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const h = createDb();
  try {
    const itemFilter = o.items.length ? sql`AND i.key IN (${sql.join(o.items.map((k) => sql`${k}`), sql`, `)})` : sql``;
    const rows = (await h.db.execute(sql`
      SELECT i.key AS item, c.level, c.topic_key, cv.front
      FROM cards c
      JOIN kb_items i ON i.id = c.kb_item_id
      JOIN card_versions cv ON cv.id = c.current_version_id
      WHERE c.status = 'active' AND c.audience = ${o.audience} AND i.module = ${o.module} ${itemFilter}
      ORDER BY i.key, CASE c.level WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, c.topic_key
    `)) as unknown as { item: string; level: string; topic_key: string; front: string }[];

    const lines = rows.map((r) => [r.item, r.level, r.topic_key, r.front.split("\n")[0].trim()].join(" | "));
    const text = lines.join("\n");
    if (o.out) {
      fs.writeFileSync(path.resolve(o.out), text + "\n", "utf8");
      console.error(`${lines.length} cards written to ${path.resolve(o.out)}`);
    } else {
      console.log(text);
      console.error(`\n${lines.length} cards (${o.module}, ${o.audience}${o.items.length ? `, items: ${o.items.join(", ")}` : ""})`);
    }
  } finally {
    await h.close();
  }
}

main().catch((err) => {
  console.error("Error exporting the ledger:", err instanceof Error ? err.message : err);
  process.exit(1);
});
