import type { DB } from "@/db/client";

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
}

export const DEFAULT_PUSH_OPTIONS: PushOptions = { mode: "append", purgeScope: "audience", dryRun: false };

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
}
