import { and, eq, inArray } from "drizzle-orm";
import { cardFeedback, cardRelatedItems, cardReviews, cards, cardVersions, deckCards, kbItems, reviewSchedule } from "@/db/schema";
import type { Catalog } from "./catalog";
import type { PurgeScope, Tx } from "./types";

export const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Deletes the cards of the catalog's module and everything that hangs off them: feedback, reviews, deck entries, the
 * review schedule, links and versions. Users' history on those cards is lost, which is why this is opt-in.
 * Returns how many cards were deleted.
 */
export async function purgeCards(tx: Tx, catalog: Catalog, scope: PurgeScope): Promise<number> {
  const where =
    scope === "module" ? eq(kbItems.module, catalog.module) : and(eq(kbItems.module, catalog.module), eq(cards.audience, catalog.audience));

  const cardIds = (await tx.select({ id: cards.id }).from(cards).innerJoin(kbItems, eq(cards.kbItemId, kbItems.id)).where(where)).map((r) => r.id);
  if (cardIds.length === 0) return 0;

  const versionIds = (await tx.select({ id: cardVersions.id }).from(cardVersions).where(inArray(cardVersions.cardId, cardIds))).map((r) => r.id);

  // Rows that point at card versions first, then at cards, then the cards themselves.
  for (const ids of chunk(versionIds, 500)) {
    await tx.delete(cardFeedback).where(inArray(cardFeedback.cardVersionId, ids));
    await tx.delete(cardReviews).where(inArray(cardReviews.cardVersionId, ids));
  }
  for (const ids of chunk(cardIds, 500)) {
    await tx.delete(deckCards).where(inArray(deckCards.cardId, ids));
    await tx.delete(reviewSchedule).where(inArray(reviewSchedule.cardId, ids));
    await tx.delete(cardRelatedItems).where(inArray(cardRelatedItems.cardId, ids));
    await tx.update(cards).set({ currentVersionId: null }).where(inArray(cards.id, ids)); // breaks the cards <-> versions cycle
    await tx.delete(cardVersions).where(inArray(cardVersions.cardId, ids));
    await tx.delete(cards).where(inArray(cards.id, ids));
  }
  return cardIds.length;
}
