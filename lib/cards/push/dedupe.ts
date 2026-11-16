/**
 * Near-duplicate detection on card TITLES, used before a push writes anything.
 *
 * The card id (item key + audience + level + topic_key) only catches an exact repeat. A reworded card with a new
 * topic_key would slip in as a second card teaching the same thing. Titles are written to be self-describing, so
 * comparing them (within one item, across all levels) is a cheap and reliable way to catch that.
 *
 * Pure functions only: no database access, so they are easy to test.
 */

export const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/** Words that carry no topic: dropped before comparing. */
const STOP = new Set(
  (
    "a an the of to in on at for from by with without and or but if is are was were be been being do does did can could will would " +
    "should may might must not no cannot cant dont doesnt this that these those it its as than then so such into onto over under " +
    "again also only just still more most any all each every both what why how when where which who whom whose whether about after before " +
    "during between against through up down out off one two there here their they them you your we our us i he she his her"
  ).split(/\s+/),
);

/** Lowercase, British to American spelling for the common -ise words, strip punctuation. */
function words(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** A light stem so "receipts / receipt", "authorised / authorized / authorize", "saved / save" compare equal. */
function stem(w: string): string {
  let s = w.replace(/is(e|ed|es|ing|ation)$/, "iz$1");
  if (s.length > 4) s = s.replace(/(ations?|ation|ing|ed|es|e|s)$/, "");
  return s;
}

/** The set of topic words of a title (stop words removed, stemmed). */
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(title)) {
    if (STOP.has(w)) continue;
    const s = stem(w);
    if (s.length > 1) out.add(s);
  }
  return out;
}

/** Jaccard overlap of the topic words of two titles, 0 (nothing shared) to 1 (same words). */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface TitledCard {
  /** the item the card belongs to (kb item key): only cards of the same item are compared */
  item: string;
  /** card id (gen:...) */
  id: string;
  level: string;
  title: string;
}

export interface SimilarPair {
  item: string;
  newId: string;
  newLevel: string;
  newTitle: string;
  otherId: string;
  otherLevel: string;
  otherTitle: string;
  /** true when the other card is already in the database; false when it is another card of the same file */
  existing: boolean;
  score: number;
}

/**
 * Finds new cards whose title is too close to a card already stored for the same item, or to another new card.
 * A new card is one whose id is not stored yet. `existing` holds the cards stored for the items of this file.
 * Cards with the same id are never compared with each other (that is a revision, reported separately).
 */
export function findSimilarTitles(
  fresh: TitledCard[],
  existing: TitledCard[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): SimilarPair[] {
  const out: SimilarPair[] = [];
  const byItem = new Map<string, TitledCard[]>();
  for (const e of existing) byItem.set(e.item, [...(byItem.get(e.item) ?? []), e]);

  fresh.forEach((c, i) => {
    for (const e of byItem.get(c.item) ?? []) {
      if (e.id === c.id) continue;
      const score = titleSimilarity(c.title, e.title);
      if (score >= threshold) out.push(pair(c, e, true, score));
    }
    // only look at earlier cards of the file so each pair is reported once
    for (let j = 0; j < i; j++) {
      const o = fresh[j];
      if (o.item !== c.item || o.id === c.id) continue;
      const score = titleSimilarity(c.title, o.title);
      if (score >= threshold) out.push(pair(c, o, false, score));
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

function pair(c: TitledCard, o: TitledCard, existing: boolean, score: number): SimilarPair {
  return {
    item: c.item,
    newId: c.id,
    newLevel: c.level,
    newTitle: c.title,
    otherId: o.id,
    otherLevel: o.level,
    otherTitle: o.title,
    existing,
    score: Math.round(score * 100) / 100,
  };
}
