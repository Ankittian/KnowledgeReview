import crypto from "node:crypto";
import { kbItems } from "@/db/schema";
import type { CardGroup, Catalog } from "./catalog";
import type { Tx } from "./types";

export const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** In-memory index of kb_items, loaded once per catalog so card and link lookups do not each hit the database. */
export class KbIndex {
  private byKey = new Map<string, number>();
  private byTypeKey = new Map<string, number>();
  private idsByKey = new Map<string, number[]>();
  private byYamlFile = new Map<string, number>();
  private byRuleKey = new Map<string, number>();

  static async load(tx: Tx): Promise<KbIndex> {
    const idx = new KbIndex();
    const rows = await tx.select({ id: kbItems.id, type: kbItems.type, key: kbItems.key, yamlFile: kbItems.yamlFile }).from(kbItems).orderBy(kbItems.id);
    for (const r of rows) idx.add(r);
    return idx;
  }

  /** First row wins on duplicate keys, so lookups stay deterministic. */
  add(r: { id: number; type: string; key: string; yamlFile: string }) {
    if (!this.byKey.has(r.key)) this.byKey.set(r.key, r.id);
    if (!this.byTypeKey.has(`${r.type}:${r.key}`)) this.byTypeKey.set(`${r.type}:${r.key}`, r.id);
    this.idsByKey.set(r.key, [...(this.idsByKey.get(r.key) ?? []), r.id]);
    if (!this.byYamlFile.has(r.yamlFile)) this.byYamlFile.set(r.yamlFile, r.id);
    if (r.type === "rule" && !this.byRuleKey.has(r.key)) this.byRuleKey.set(r.key, r.id);
  }

  findByKey(key: string): number | undefined {
    return this.byKey.get(key);
  }

  /**
   * The kb_item a card group belongs to. The group's scope fixes the item type (form, process or module), so the lookup
   * is by type AND key: a flow whose key happens to equal a form key must not attach to that form. When no item of that
   * type exists, a key that belongs to exactly one item (of any type) is still accepted, so older catalogs keep working;
   * an ambiguous key is not guessed, the item is created instead.
   */
  findForGroup(scope: CardGroup["scope"], key: string): number | undefined {
    const exact = this.byTypeKey.get(`${TYPE_BY_SCOPE[scope]}:${key}`);
    if (exact !== undefined) return exact;
    const ids = this.idsByKey.get(key);
    return ids && ids.length === 1 ? ids[0] : undefined;
  }

  /** A `source_refs` entry points at a KB item by yaml file, by `rule:<key>` or by plain key (in that order). */
  resolveRef(ref: string): number | undefined {
    const byFile = this.byYamlFile.get(ref);
    if (byFile !== undefined) return byFile;
    if (ref.startsWith("rule:")) {
      const rule = this.byRuleKey.get(ref.slice("rule:".length));
      if (rule !== undefined) return rule;
    }
    return this.byKey.get(ref);
  }
}

const TYPE_BY_SCOPE = { flow: "process", module: "module", form: "form" } as const;

/**
 * The yaml_file recorded for an item this push creates. A form takes the file of its first source; a flow or a module
 * never does, because its sources are the forms it was compared across and the item must not claim one of their files.
 */
function yamlFileFor(group: CardGroup): string {
  if (group.scope === "form") return group.cards[0]?.source_refs?.[0] ?? `forms/${group.key}.yaml`;
  if (group.scope === "module") return `modules/${group.key}.yaml`;
  return `processes/${group.key}.yaml`;
}

/** The kb_item a card group belongs to, without creating it: undefined when it does not exist yet. */
export function findKbItem(idx: KbIndex, group: CardGroup): number | undefined {
  return idx.findForGroup(group.scope, group.key);
}

/** The kb_item a card group belongs to; created (marked `generated`) when the KB sync has not loaded it. */
export async function ensureKbItem(tx: Tx, idx: KbIndex, catalog: Catalog, group: CardGroup): Promise<{ id: number; created: boolean }> {
  const existing = idx.findForGroup(group.scope, group.key);
  if (existing !== undefined) return { id: existing, created: false };

  const type = TYPE_BY_SCOPE[group.scope];
  const yamlFile = yamlFileFor(group);
  const [row] = await tx
    .insert(kbItems)
    .values({
      type,
      key: group.key,
      name: group.title,
      module: catalog.module,
      yamlFile,
      contentHash: sha([group.key, group.title, group.context ?? ""].join(":")),
      meta: { scope: group.scope, context: group.context, generated: true },
      active: true,
    })
    .returning({ id: kbItems.id });
  idx.add({ id: row.id, type, key: group.key, yamlFile });
  return { id: row.id, created: true };
}
