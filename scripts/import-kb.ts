import "./_env";
import fs from "node:fs";
import path from "node:path";

// Copies a KnowledgeGraph/domain-style folder into ./kb (or KB_DIR). Usage: npm run kb:import -- <source-dir>
const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run kb:import -- <path to domain folder (modules.yaml, concepts.yaml, rules.yaml, processes/, forms/)>");
  process.exit(1);
}
const from = path.resolve(src);
const to = path.resolve(process.env.KB_DIR ?? "kb");
for (const f of ["modules.yaml", "concepts.yaml", "rules.yaml"]) {
  if (!fs.existsSync(path.join(from, f))) {
    console.error(`Missing ${f} in ${from}`);
    process.exit(1);
  }
}
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
for (const f of ["modules.yaml", "concepts.yaml", "rules.yaml"]) fs.copyFileSync(path.join(from, f), path.join(to, f));
let n = 3;
for (const d of ["processes", "forms"]) {
  const sd = path.join(from, d);
  if (!fs.existsSync(sd)) continue;
  fs.mkdirSync(path.join(to, d));
  for (const f of fs.readdirSync(sd).filter((x) => /\.ya?ml$/i.test(x))) {
    fs.copyFileSync(path.join(sd, f), path.join(to, d, f));
    n++;
  }
}
console.log(`Copied ${n} YAML files from ${from} to ${to}. Run \`npm run cards:sync\` next.`);
