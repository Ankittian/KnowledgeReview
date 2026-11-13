import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Input of the card push: one JSON catalog per module and audience, e.g. data/generated-cards/MM.functional.json.
 *
 *   { module, audience, items: [ { scope, key, title, context, cards: [ { level, topic_key, title, body, source_refs } ] } ] }
 */
const cardSchema = z.object({
  level: z.enum(["easy", "medium", "hard"]),
  topic_key: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  /** KB yaml files, keys or `rule:<key>` the card was written from; become `source` links. */
  source_refs: z.array(z.string()).optional(),
});

const groupSchema = z.object({
  scope: z.enum(["module", "flow", "form"]),
  key: z.string().min(1),
  title: z.string().min(1),
  context: z.string().optional(),
  cards: z.array(cardSchema),
});

export const catalogSchema = z.object({
  module: z.string().min(1),
  title: z.string().optional(),
  audience: z.enum(["functional", "technical"]),
  total_cards: z.number().optional(),
  breakdown: z.record(z.string(), z.number()).optional(),
  items: z.array(groupSchema),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CardGroup = Catalog["items"][number];
export type CardItem = CardGroup["cards"][number];

export const DEFAULT_CATALOG_DIR = "data/generated-cards";

/** Explicit files, or every *.json in the default folder. */
export function resolveCatalogFiles(args: string[], dir = DEFAULT_CATALOG_DIR): string[] {
  if (args.length > 0) return args;
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** The card id: stable across pushes, so a re-push finds the same card. */
export const cardIdOf = (c: Catalog, group: CardGroup, card: CardItem) => `gen:${group.key}:${c.audience}:${card.level}:${card.topic_key}`;

/** Reads and validates one catalog file. Throws a readable error for bad JSON, a bad shape or duplicate card ids. */
export function loadCatalog(file: string): Catalog {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    throw new Error(`${file}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }

  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`${file}: invalid catalog\n${issues.join("\n")}`);
  }

  const catalog = parsed.data;
  const seen = new Set<string>();
  for (const group of catalog.items) {
    for (const card of group.cards) {
      const id = cardIdOf(catalog, group, card);
      if (seen.has(id)) throw new Error(`${file}: duplicate card id ${id} (topic_key must be unique per group and level)`);
      seen.add(id);
    }
  }
  return catalog;
}

export const countCards = (c: Catalog) => c.items.reduce((n, g) => n + g.cards.length, 0);
