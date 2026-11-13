import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { cardIdOf, type Catalog } from "./catalog";
import { linkSources, loadExistingCards, writeCard } from "./cards";
import { ensureKbItem, KbIndex } from "./kb-items";
import { purgeCards } from "./purge";
import { DEFAULT_PUSH_OPTIONS, type PushOptions, type PushResult } from "./types";

export * from "./catalog";
export * from "./types";

class DryRun extends Error {}

/**
 * Pushes one catalog into Postgres in a single transaction: a failure leaves the database as it was.
 *
 *   1. purge (mode "purge" only): delete the module's existing cards and what hangs off them
 *   2. make sure every group has a kb_item
 *   3. write each card (new card, new version of a changed card, or untouched)
 *   4. link each card to the KB items named in its source_refs
 */
export async function pushCatalog(db: DB, catalog: Catalog, options: Partial<PushOptions> = {}): Promise<PushResult> {
  const opts = { ...DEFAULT_PUSH_OPTIONS, ...options };
  const result: PushResult = {
    module: catalog.module,
    audience: catalog.audience,
    mode: opts.mode,
    dryRun: opts.dryRun,
    purged: 0,
    kbItemsCreated: 0,
    cardsInserted: 0,
    cardsNewVersion: 0,
    cardsUnchanged: 0,
    linksInserted: 0,
  };

  try {
    await db.transaction(async (tx) => {
      if (opts.mode === "purge") result.purged = await purgeCards(tx, catalog, opts.purgeScope);

      const idx = await KbIndex.load(tx);
      const ids = catalog.items.flatMap((g) => g.cards.map((c) => cardIdOf(catalog, g, c)));
      const existing = await loadExistingCards(tx, ids);

      for (const group of catalog.items) {
        const kb = await ensureKbItem(tx, idx, catalog, group);
        if (kb.created) result.kbItemsCreated++;

        for (const card of group.cards) {
          const { id, outcome } = await writeCard(tx, existing, kb.id, catalog, group, card);
          if (outcome === "inserted") result.cardsInserted++;
          else if (outcome === "new_version") result.cardsNewVersion++;
          else result.cardsUnchanged++;
          result.linksInserted += await linkSources(tx, idx, id, card);
        }
      }

      if (opts.dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return result;
}

/** Cards in the database by module, audience and level, plus the totals (for the CLI's closing report). */
export async function cardSummary(db: DB) {
  const byGroup = await db.execute(sql`
    SELECT COALESCE(i.module, 'UNKNOWN') AS module, c.audience, c.level, count(*)::int AS count
    FROM cards c
    JOIN kb_items i ON i.id = c.kb_item_id
    GROUP BY i.module, c.audience, c.level
    ORDER BY i.module, c.audience, c.level
  `);
  const [active] = await db.execute(sql`SELECT count(*)::int AS n FROM cards WHERE status = 'active'`);
  const [health] = await db.execute(sql`SELECT count(*)::int AS n FROM card_health`);
  return { byGroup, activeCards: Number(active.n), healthRows: Number(health.n) };
}
