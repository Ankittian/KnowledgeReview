import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { kbItems } from "@/db/schema";
import { cardIdOf, type Catalog } from "./catalog";
import { cardHash, linkSources, loadExistingCards, loadExistingTitles, writeCard } from "./cards";
import { findSimilarTitles, type TitledCard } from "./dedupe";
import { ensureKbItem, findKbItem, KbIndex } from "./kb-items";
import { purgeCards } from "./purge";
import { DEFAULT_PUSH_OPTIONS, PushRefused, type PushOptions, type PushResult } from "./types";

export * from "./catalog";
export * from "./dedupe";
export * from "./types";

class DryRun extends Error {}

/**
 * Pushes one catalog into Postgres in a single transaction: a failure leaves the database as it was.
 *
 *   1. purge (mode "purge" only): delete the module's existing cards and what hangs off them
 *   2. check the new cards: titles too close to a stored card of the same item (or to each other), and cards that would
 *      be revised; a real push refuses on the first (unless told otherwise), a dry run only reports
 *   3. make sure every group has a kb_item
 *   4. write each card (new card, new version of a changed card, or untouched)
 *   5. link each card to the KB items named in its source_refs, and report refs that match nothing
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
    similar: [],
    revisions: [],
    unresolvedRefs: [],
  };

  try {
    await db.transaction(async (tx) => {
      if (opts.mode === "purge") result.purged = await purgeCards(tx, catalog, opts.purgeScope);

      const idx = await KbIndex.load(tx);
      const ids = catalog.items.flatMap((g) => g.cards.map((c) => cardIdOf(catalog, g, c)));
      const existing = await loadExistingCards(tx, ids);

      // cards that already exist with different text would get a new version
      for (const group of catalog.items) {
        for (const card of group.cards) {
          const id = cardIdOf(catalog, group, card);
          const known = existing.get(id);
          if (known?.hash && known.hash !== cardHash(group, card)) result.revisions.push({ id, title: card.title });
        }
      }
      if (!opts.allowRevisions && result.revisions.length > 0) {
        throw new PushRefused(`${result.revisions.length} card(s) already exist with different text and would be revised`, [], result.revisions);
      }

      // new cards whose title is too close to a stored card of the same item, or to another new card
      if (opts.duplicates !== "off") {
        const fresh: TitledCard[] = catalog.items.flatMap((g) =>
          g.cards
            .map((c) => ({ item: g.key, id: cardIdOf(catalog, g, c), level: c.level, title: c.title.split("\n")[0] }))
            .filter((c) => !existing.has(c.id)),
        );
        const itemIds = catalog.items.map((g) => findKbItem(idx, g)).filter((x): x is number => x !== undefined);
        result.similar = findSimilarTitles(fresh, await loadExistingTitles(tx, itemIds, catalog.audience), opts.similarity);
        if (result.similar.length > 0 && opts.duplicates === "error" && !opts.dryRun) {
          throw new PushRefused(`${result.similar.length} new card(s) repeat a topic that is already taught`, result.similar);
        }
      }

      const usedKbItems = new Set<number>();
      for (const group of catalog.items) {
        const kb = await ensureKbItem(tx, idx, catalog, group);
        if (kb.created) result.kbItemsCreated++;
        usedKbItems.add(kb.id);

        for (const card of group.cards) {
          const { id, outcome } = await writeCard(tx, existing, kb.id, catalog, group, card);
          if (outcome === "inserted") result.cardsInserted++;
          else if (outcome === "new_version") result.cardsNewVersion++;
          else result.cardsUnchanged++;
          const links = await linkSources(tx, idx, id, card);
          result.linksInserted += links.created;
          for (const ref of links.unresolved) result.unresolvedRefs.push({ item: group.key, topicKey: card.topic_key, ref });
        }
      }

      // Items created by this push are not in the YAML, so the KB sync marks them inactive (and hides them in Browse)
      // on its next run. Their cards are live, so switch them back on every time.
      if (usedKbItems.size > 0) {
        await tx
          .update(kbItems)
          .set({ active: true })
          .where(and(inArray(kbItems.id, [...usedKbItems]), eq(kbItems.active, false), sql`${kbItems.meta}->>'generated' = 'true'`));
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
