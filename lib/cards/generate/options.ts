import { sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import type { Audience } from "./config";
import { availableAudiences } from "./prompt";

const counts = (i: { functional: number; technical: number }): Record<Audience, number> => ({ functional: Number(i.functional), technical: Number(i.technical) });

/** What the New generation screen offers: the forms and modules of the knowledge base with their current card counts. */
export interface FormOption {
  key: string;
  name: string;
  module: string;
  /** active cards of this form, per audience */
  cards: Record<Audience, number>;
}
export interface ModuleOption {
  key: string;
  name: string;
  forms: number;
  /** cards under the module itself, its flows and common patterns */
  commonCards: Record<Audience, number>;
}
export interface GenerationOptions {
  forms: FormOption[];
  modules: ModuleOption[];
  /** audiences that have a prompt template (the others are shown as not available yet) */
  audiences: Audience[];
}

export async function loadGenerationOptions(db: DB): Promise<GenerationOptions> {
  const items = await query<{ type: string; key: string; name: string; module: string | null; functional: number; technical: number }>(
    db,
    sql`SELECT i.type, i.key, i.name, i.module,
          (SELECT count(*)::int FROM cards c WHERE c.kb_item_id = i.id AND c.status = 'active' AND c.audience = 'functional') AS functional,
          (SELECT count(*)::int FROM cards c WHERE c.kb_item_id = i.id AND c.status = 'active' AND c.audience = 'technical') AS technical
        FROM kb_items i WHERE i.active AND i.module IS NOT NULL ORDER BY i.name`,
  );
  const forms: FormOption[] = items.filter((i) => i.type === "form").map((i) => ({ key: i.key, name: i.name, module: i.module!, cards: counts(i) }));
  const modules: ModuleOption[] = items
    .filter((i) => i.type === "module")
    .map((m) => ({
      key: m.key,
      name: m.name,
      forms: forms.filter((f) => f.module === m.key).length,
      commonCards: {
        functional: items.filter((i) => i.module === m.key && i.type !== "form").reduce((n, i) => n + Number(i.functional), 0),
        technical: items.filter((i) => i.module === m.key && i.type !== "form").reduce((n, i) => n + Number(i.technical), 0),
      },
    }))
    .filter((m) => m.forms > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  return { forms, modules, audiences: availableAudiences() };
}
