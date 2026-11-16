import type { DB } from "@/db/client";
import type { SimilarPair } from "./dedupe";

/** The transaction handle drizzle passes to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * append = add what is new, add a new card version where the text changed, leave everything else (and all reviews) alone.
 * purge  = first delete the existing cards of the catalog's module (and everything attached to them), then insert.
 */
export type PushMode = "append" | "purge";

/** What `purge` deletes: only the catalog's audience within its module, or every card of the module (legacy ones too). */
export type PurgeScope = "audience" | "module";

export interface PushOptions {
  mode: PushMode;
  purgeScope: PurgeScope;
  /** Do all the work inside the transaction, report the counts, then roll back. */
  dryRun: boolean;
  /**
   * What to do when a new card's title is too close to a stored card of the same item (or to another new card):
   * error (default) refuses the push, warn only reports it, off skips the check. A dry run only reports.
   */
  duplicates: "error" | "warn" | "off";
  /** Title similarity (0 to 1) from which two cards count as the same topic. */
  similarity: number;
  /** false: refuse the push when a card would get a new version (same id, changed text), instead of replacing its text. */
  allowRevisions: boolean;
}

export const DEFAULT_PUSH_OPTIONS: PushOptions = {
  mode: "append",
  purgeScope: "audience",
  dryRun: false,
  duplicates: "error",
  similarity: 0.6,
  allowRevisions: true,
};

/** A `source_refs` entry that matched no KB item, so the card has no link to it. */
export interface UnresolvedRef {
  item: string;
  topicKey: string;
  ref: string;
}

export interface PushResult {
  module: string;
  audience: string;
  mode: PushMode;
  dryRun: boolean;
  purged: number;
  kbItemsCreated: number;
  cardsInserted: number;
  cardsNewVersion: number;
  cardsUnchanged: number;
  linksInserted: number;
  /** new cards whose title is too close to another card of the same item */
  similar: SimilarPair[];
  /** cards that already exist and would get a new version (their text changed) */
  revisions: { id: string; title: string }[];
  /** source_refs that did not resolve to a KB item */
  unresolvedRefs: UnresolvedRef[];
}

/** Thrown by a real push that is refused because of similar titles or (with allowRevisions off) revised cards. */
export class PushRefused extends Error {
  constructor(
    message: string,
    readonly similar: SimilarPair[] = [],
    readonly revisions: { id: string; title: string }[] = [],
  ) {
    super(message);
    this.name = "PushRefused";
  }
}
