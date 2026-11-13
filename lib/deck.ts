import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { cardReviews, cards, cardVersions, dailyDecks, deckCards, kbItems } from "@/db/schema";
import { audienceIn } from "./cards/audience";
import { LEVELS, countWords, minReadSeconds, type Audience, type Level } from "./cards/spec";
import { logEvent } from "./events";
import { getDailyCardLimit } from "./settings";

export interface DeckPools {
  /** spaced-repetition cards due today */
  due: string[];
  /** cards part-way to verification quorum or with conflicting verdicts (user's own module only) */
  priority: string[];
  /** cards nobody has reviewed yet (user's module first) */
  fresh: string[];
  /** anything active the user hasn't seen */
  fallback: string[];
}

export const VERIFY_QUORUM = 3;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic shuffle (mulberry32) so a user's deck order is stable for the day. */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  let a = hashSeed(seed);
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Mix: up to 50% due reviews, ~30% verification-priority, the rest new cards; any shortfall is
 * filled from the other pools so the deck is full whenever enough cards exist.
 */
export function composeDeck(p: DeckPools, size: number, seed = ""): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (arr: string[], n: number) => {
    for (const id of arr) {
      if (out.length >= size || n <= 0) break;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      n--;
    }
  };
  take(p.due, Math.ceil(size * 0.5));
  take(p.priority, Math.ceil(size * 0.3));
  take(p.fresh, size - out.length);
  take(p.priority, size - out.length);
  take(p.due, size - out.length);
  take(p.fallback, size - out.length);
  return seed ? seededShuffle(out, seed) : out;
}

export async function loadDeckPools(
  db: DB,
  userId: string,
  module: string | null,
  today: string,
  size: number,
  seed: string = crypto.randomUUID(),
  audiences: Audience[] = ["functional"],
): Promise<DeckPools> {
  const lim = Math.max(size * 3, 30);
  const ids = (rows: { card_id: string }[]) => rows.map((r) => r.card_id);

  const due = await query<{ card_id: string }>(
    db,
    sql`SELECT s.card_id FROM review_schedule s JOIN cards c ON c.id = s.card_id
        WHERE s.user_id = ${userId} AND s.due_date <= ${today}::date AND c.status = 'active' AND ${audienceIn(sql`c.audience`, audiences)}
        ORDER BY s.due_date, s.box, md5(s.card_id || ${seed}) LIMIT ${lim}`,
  );
  const unseen = sql`NOT EXISTS (SELECT 1 FROM review_schedule s WHERE s.user_id = ${userId} AND s.card_id = ch.card_id)`;
  const moduleFirst = module ? sql`coalesce(ch.module = ${module}, false) DESC,` : sql``;
  const priority = await query<{ card_id: string }>(
    db,
    sql`SELECT ch.card_id FROM card_health ch
        WHERE ch.status = 'active' AND ${audienceIn(sql`ch.audience`, audiences)} AND ${unseen}
          AND ((ch.reviewers BETWEEN 1 AND ${VERIFY_QUORUM - 1}) OR ch.conflicting)
          ${module ? sql`AND ch.module = ${module}` : sql``}
        ORDER BY ${moduleFirst} ch.conflicting DESC, ch.reviewers DESC, md5(ch.card_id || ${seed}) LIMIT ${lim}`,
  );
  const fresh = await query<{ card_id: string }>(
    db,
    sql`SELECT ch.card_id FROM card_health ch
        WHERE ch.status = 'active' AND ${audienceIn(sql`ch.audience`, audiences)} AND ch.reviewers = 0 AND ${unseen}
        ORDER BY ${moduleFirst} md5(ch.card_id || ${seed}) LIMIT ${lim}`,
  );
  const fallback = await query<{ card_id: string }>(
    db,
    sql`SELECT ch.card_id FROM card_health ch
        WHERE ch.status = 'active' AND ${audienceIn(sql`ch.audience`, audiences)} AND ${unseen}
        ORDER BY ${moduleFirst} md5(ch.card_id || ${seed}) LIMIT ${lim}`,
  );
  return { due: ids(due), priority: ids(priority), fresh: ids(fresh), fallback: ids(fallback) };
}

/** What the employee UI receives: no card id, entity, YAML or link information. */
export interface ClientCard {
  v: number; // card_version id (opaque)
  context: string;
  front: string;
  back: string;
  module: string | null;
  /** generated cards are statements to verify: shown whole, answered with Known / New / Incorrect, after a read-time lock */
  statement: boolean;
  level: Level | null;
  /** what a valid answer is worth (Easy 1, Medium 3, Hard 5) */
  weight: number;
  /** seconds before the answer buttons unlock (words / 5, at least 4); 0 for non-statement cards */
  minRead: number;
}

export interface TodayDeck {
  deckId: number | null;
  date: string;
  cards: ClientCard[];
  /** version ids of this deck's cards already answered */
  answered: number[];
  /** answers given today across all decks (sign-ins) */
  answeredToday: number;
  dailyLimit: number;
}

/**
 * The deck for this sign-in. A new random set is generated for every new session (and for a new day). Its size is
 * whatever is left of the admin's daily limit, so signing in again never shows more than the limit in one day.
 * If this session's set is finished but the limit still has room (e.g. the admin raised it), it is topped up.
 */
export async function getOrCreateDeck(
  db: DB,
  user: { id: string; primaryModule: string | null },
  today: string,
  sessionId: string,
  audiences: Audience[] = ["functional"],
): Promise<TodayDeck> {
  const dailyLimit = await getDailyCardLimit(db);
  const answeredRows = await db
    .select({ cardId: cardVersions.cardId })
    .from(cardReviews)
    .innerJoin(dailyDecks, eq(dailyDecks.id, cardReviews.deckId))
    .innerJoin(cardVersions, eq(cardVersions.id, cardReviews.cardVersionId))
    .where(and(eq(cardReviews.userId, user.id), eq(dailyDecks.deckDate, today)));
  const answeredCards = new Set(answeredRows.map((r) => r.cardId));
  const answeredToday = answeredCards.size;

  let [deck] = await db
    .select()
    .from(dailyDecks)
    .where(and(eq(dailyDecks.userId, user.id), eq(dailyDecks.deckDate, today), eq(dailyDecks.sessionId, sessionId)))
    .orderBy(desc(dailyDecks.id))
    .limit(1);

  let deckCardIds = deck ? await loadDeckCardIds(db, deck.id) : [];
  const activeOpen = deck ? await activeUnanswered(db, deckCardIds, answeredCards, audiences) : 0;
  const remaining = dailyLimit - answeredToday;
  if ((!deck || activeOpen === 0) && remaining > 0) {
    const seed = crypto.randomUUID();
    const pools = await loadDeckPools(db, user.id, user.primaryModule, today, remaining, seed, audiences);
    const cardIds = composeDeck(pools, remaining, seed).filter((id) => !answeredCards.has(id));
    if (cardIds.length) {
      const [{ dropped }] = await query<{ dropped: number }>(
        db,
        sql`SELECT count(*)::int AS dropped
            FROM daily_decks d JOIN deck_cards dc ON dc.deck_id = d.id
            WHERE d.user_id = ${user.id} AND d.deck_date = ${today}::date AND d.completed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM card_reviews r JOIN daily_decks d2 ON d2.id = r.deck_id JOIN card_versions v ON v.id = r.card_version_id
                              WHERE r.user_id = d.user_id AND d2.deck_date = d.deck_date AND v.card_id = dc.card_id)`,
      );
      [deck] = await db.insert(dailyDecks).values({ userId: user.id, sessionId, deckDate: today }).returning();
      await db.insert(deckCards).values(cardIds.map((cardId, position) => ({ deckId: deck.id, cardId, position })));
      deckCardIds = cardIds;
      await logEvent(db, {
        userId: user.id,
        sessionId,
        type: "deck_created",
        payload: { deck_id: deck.id, deck_date: today, size: cardIds.length, daily_limit: dailyLimit, answered_today: answeredToday, unanswered_in_earlier_decks: dropped },
      });
    }
  }
  if (!deck) return { deckId: null, date: today, cards: [], answered: [], answeredToday, dailyLimit };

  const rows = await db
    .select({ cardId: cards.id, v: cardVersions.id, context: cardVersions.context, front: cardVersions.front, back: cardVersions.back, module: kbItems.module, status: cards.status, audience: cards.audience, level: cards.level })
    .from(cards)
    .innerJoin(cardVersions, eq(cardVersions.id, cards.currentVersionId))
    .innerJoin(kbItems, eq(kbItems.id, cards.kbItemId))
    .where(inArray(cards.id, deckCardIds));
  const moduleNames = await getModuleNames(db);
  const byId = new Map(rows.map((r) => [r.cardId, r]));

  const out: ClientCard[] = [];
  const answered: number[] = [];
  // answers from this deck, plus at most `remaining` open cards (the admin may have lowered the limit meanwhile)
  let open = Math.max(0, remaining);
  for (const id of deckCardIds) {
    const r = byId.get(id);
    if (!r || r.status !== "active" || !r.audience || !audiences.includes(r.audience)) continue;
    const isAnswered = answeredCards.has(id);
    if (!isAnswered && open-- <= 0) continue;
    out.push({
      v: r.v,
      context: r.context,
      front: r.front,
      back: r.back,
      module: r.module ? (moduleNames.get(r.module) ?? r.module) : null,
      statement: true,
      level: r.level,
      weight: r.level ? LEVELS[r.level].weight : 0,
      minRead: minReadSeconds(countWords(r.back)),
    });
    if (isAnswered) answered.push(r.v);
  }
  return { deckId: deck.id, date: today, cards: out, answered, answeredToday, dailyLimit };
}

async function loadDeckCardIds(db: DB, deckId: number): Promise<string[]> {
  const rows = await db.select({ cardId: deckCards.cardId }).from(deckCards).where(eq(deckCards.deckId, deckId)).orderBy(deckCards.position);
  return rows.map((r) => r.cardId);
}

async function activeUnanswered(db: DB, cardIds: string[], answered: Set<string>, audiences: Audience[]): Promise<number> {
  const open = cardIds.filter((id) => !answered.has(id));
  if (!open.length) return 0;
  const rows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(inArray(cards.id, open), eq(cards.status, "active"), inArray(cards.audience, audiences)));
  return rows.length;
}

export async function getModuleNames(db: DB): Promise<Map<string, string>> {
  const rows = await db.select({ key: kbItems.key, name: kbItems.name }).from(kbItems).where(eq(kbItems.type, "module"));
  return new Map(rows.map((r) => [r.key, r.name]));
}
