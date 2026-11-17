import fs from "node:fs";
import path from "node:path";

/**
 * Adds graph element ids to the `source_refs` of generated card catalogs.
 *
 *   npm run cards:element-ids -- collect [files...]            list the node ids used, plus the Cypher query to look them up
 *   npm run cards:element-ids -- apply <map.json> [files...]   rewrite refs to "Name [<element id>] (<node id>)"
 *   (add --dry-run to `apply` to show what would change without writing)
 *
 * <map.json> is { "form:fGRN": "4:<uuid>:61031", ... }, the result of the Cypher query printed by `collect`
 * (a run_cypher result array of { "n.id": ..., "elementId(n)": ... } rows is accepted as well).
 * Files default to every *.json in data/generated-cards/. Refs that already carry an element id are left alone,
 * and a node id missing from the map is reported and left unchanged: an id is never guessed.
 */

const DIR = path.join(process.cwd(), "data", "generated-cards");
const NODE_ID = /\(([a-z]+:[^()\s]+)\)\s*$/;
const ELEMENT_ID = /\[(\d+:[0-9a-fA-F-]{36}:\d+)\]/;
const ELEMENT_ID_SHAPE = /^\d+:[0-9a-fA-F-]{36}:\d+$/;

interface Catalog {
  items: { cards: { source_refs?: string[] }[] }[];
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const command = positional.shift();

function filesFrom(given: string[]): string[] {
  if (given.length) return given.map((f) => path.resolve(f));
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(DIR, f));
}

function eachRef(cat: Catalog, fn: (ref: string, set: (next: string) => void) => void) {
  for (const it of cat.items)
    for (const c of it.cards)
      (c.source_refs ?? []).forEach((ref, i, arr) => fn(ref, (next) => (arr[i] = next)));
}

function loadMap(file: string): Map<string, string> {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const map = new Map<string, string>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const id = r["n.id"] ?? r.id;
      const el = r["elementId(n)"] ?? r.elementId;
      if (id && el) map.set(String(id), String(el));
    }
  } else {
    for (const [id, el] of Object.entries(raw)) map.set(id, String(el));
  }
  for (const [id, el] of map) if (!ELEMENT_ID_SHAPE.test(el)) throw new Error(`Element id for ${id} is not "4:<uuid>:<number>": ${el}`);
  return map;
}

if (command === "collect") {
  const ids = new Set<string>();
  const noId: string[] = [];
  for (const f of filesFrom(positional)) {
    eachRef(JSON.parse(fs.readFileSync(f, "utf8")), (ref) => {
      const id = NODE_ID.exec(ref)?.[1];
      if (id) ids.add(id);
      else noId.push(`${path.basename(f)}: ${ref}`);
    });
  }
  const list = [...ids].sort();
  console.log(`${list.length} distinct node ids.\n`);
  console.log(`Run this with run_cypher, save the rows as a JSON file, then use it with "apply":\n`);
  console.log(`MATCH (n) WHERE n.id IN [${list.map((i) => `'${i}'`).join(", ")}] RETURN n.id, elementId(n)\n`);
  if (noId.length) {
    console.log(`${noId.length} ref(s) have no "(type:key)" node id and cannot be looked up:`);
    for (const r of noId) console.log(`  ${r}`);
  }
} else if (command === "apply") {
  const mapFile = positional.shift();
  if (!mapFile) throw new Error("Usage: apply <map.json> [files...] [--dry-run]");
  const map = loadMap(path.resolve(mapFile));
  const missing = new Set<string>();
  let changed = 0;
  let already = 0;
  for (const f of filesFrom(positional)) {
    const cat: Catalog = JSON.parse(fs.readFileSync(f, "utf8"));
    let fileChanged = 0;
    eachRef(cat, (ref, set) => {
      if (ELEMENT_ID.test(ref)) return void already++;
      const m = NODE_ID.exec(ref);
      if (!m) return;
      const el = map.get(m[1]);
      if (!el) return void missing.add(m[1]);
      set(`${ref.slice(0, m.index).trimEnd()} [${el}] (${m[1]})`);
      fileChanged++;
    });
    changed += fileChanged;
    if (fileChanged && !dryRun) fs.writeFileSync(f, JSON.stringify(cat, null, 2) + "\n");
    console.log(`${path.basename(f)}: ${fileChanged} ref(s) ${dryRun ? "would be " : ""}updated`);
  }
  console.log(`\n${changed} updated, ${already} already had an element id${dryRun ? " (dry run, nothing written)" : ""}.`);
  if (missing.size) {
    console.log(`${missing.size} node id(s) not in the map, left unchanged:`);
    for (const id of [...missing].sort()) console.log(`  ${id}`);
    process.exitCode = 1;
  }
} else {
  console.log("Usage:\n  collect [files...]\n  apply <map.json> [files...] [--dry-run]");
  process.exitCode = 1;
}
