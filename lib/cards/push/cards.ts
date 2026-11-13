import { desc, eq, inArray } from "drizzle-orm";
import { cardRelatedItems, cards, cardVersions } from "@/db/schema";
import { cardIdOf, type CardGroup, type CardItem, type Catalog } from "./catalog";
import { sha, type KbIndex } from "./kb-items";
import { chunk } from "./purge";
import type { Tx } from "./types";

/** A card already in the database, with its newest version (null when the card row has no version yet). */
export interface ExistingCard {
  version: number | null;
  hash: string | null;
}

/** The cards of this catalog that are already in the database, with the number and text hash of their newest version. */
export async function loadExistingCards(tx: Tx, ids: string[]): Promise<Map<string, ExistingCard>> {
  const out = new Map<string, ExistingCard>();
  for (const part of chunk(ids, 1000)) {
    for (const r of await tx.select({ id: cards.id }).from(cards).where(inArray(cards.id, part))) out.set(r.id, { version: null, hash: null });
    const versions = await tx
      .select({ cardId: cardVersions.cardId, version: cardVersions.version, hash: cardVersions.sourceHash })
      .from(cardVersions)
      .where(inArray(cardVersions.cardId, part))
      .orderBy(cardVersions.cardId, desc(cardVersions.version));
    for (const v of versions) {
      const e = out.get(v.cardId);
      if (e && e.version === null) {
        e.version = v.version;
        e.hash = v.hash;
      }
    }
  }
  return out;
}

export type CardOutcome = "inserted" | "new_version" | "unchanged";

/**
 * Writes one card. New card: row + version 1. Known card whose text changed: a new version becomes current (reviews on
 * the older versions stay valid). Known card with the same text: nothing.
 */
export async function writeCard(
  tx: Tx,
  existing: Map<string, ExistingCard>,
  kbItemId: number,
  catalog: Catalog,
  group: CardGroup,
  card: CardItem,
): Promise<{ id: string; outcome: CardOutcome }> {
  const id = cardIdOf(catalog, group, card);
  const context = group.context ?? group.title ?? group.key;
  const hash = sha([context, card.title, card.body].join("\n␞\n"));
  const versionValues = { cardId: id, context, front: card.title, back: card.body, sourceText: card.body, sourceHash: hash };

  let known = existing.get(id);
  if (!known) {
    await tx.insert(cards).values({
      id,
      kbItemId,
      kind: `generated.${card.level}`,
      sourceField: "generated",
      audience: catalog.audience,
      level: card.level,
      topicKey: card.topic_key,
      status: "active",
    });
    known = { version: null, hash: null };
    existing.set(id, known);
  }

  if (known.hash === hash) return { id, outcome: "unchanged" };

  // New card -> version 1; changed text -> next version (older versions and the reviews on them stay).
  const version = (known.version ?? 0) + 1;
  const [v] = await tx.insert(cardVersions).values({ ...versionValues, version }).returning({ id: cardVersions.id });
  await tx.update(cards).set({ currentVersionId: v.id, status: "active" }).where(eq(cards.id, id));
  const outcome: CardOutcome = known.version === null ? "inserted" : "new_version";
  existing.set(id, { version, hash });
  return { id, outcome };
}

/** `source` links from a card to the KB items its `source_refs` name. Returns how many links were new. */
export async function linkSources(tx: Tx, idx: KbIndex, cardId: string, card: CardItem): Promise<number> {
  let created = 0;
  for (const ref of card.source_refs ?? []) {
    const kbItemId = idx.resolveRef(ref);
    if (kbItemId === undefined) continue;
    const rows = await tx
      .insert(cardRelatedItems)
      .values({ cardId, kbItemId, relation: "source" })
      .onConflictDoNothing()
      .returning({ kbItemId: cardRelatedItems.kbItemId });
    created += rows.length;
  }
  return created;
}
