# Plan: Level 1–3 flashcards with plain, engaging wording

## Context
Cards are built from `kb/*.yaml` by `lib/cards/build.ts` using hard-coded question templates, and the answers are the raw YAML `summary` text. Some of that text is long or jargon-heavy, and cards have no difficulty concept. We want each card graded Level 1–3 by length and complexity, shown as a badge on the card, with all levels mixed in the daily deck (no change to deck composition or SRS). We also want the wording rewritten to be understandable and engaging.

Decisions (confirmed with user): level is computed by rules; wording is an LLM rewrite that a human approves; level is a badge only, and the deck mixes levels.

## 1. Level scoring (deterministic)
- New `lib/cards/level.ts` exporting `scoreCard(card): 1|2|3` and its thresholds as constants.
  - Signals, computed on the final `back` and `front`:
    - word count of `back` (L1 ≲ 25 words, L2 ≲ 55, L3 above that; tune against the real distribution);
    - line count and bullet count, which covers multi-step process cards and "Messages shown" blocks;
    - jargon density, counting formula, table or field names and code-like tokens (camelCase, `f[A-Z]…`, `_`, `=`, `%`);
    - kind weight: `concept.summary` and `process.next` lean easier; `rule.summary` of type calculation, derivation or integrity, and `process.steps`, lean harder.
  - Combine into a score and map it to a level.
- Call it from `pushCard` in `lib/cards/build.ts` (around l.197–216) and add `level` to the built card. Include it in the card's tags, e.g. `level:2`, as a fallback.
- Persist it:
  - add `level smallint not null default 1` to `cards` in `db/schema.ts` (l.82);
  - add migration `db/migrations/0002_card_level.sql`;
  - have `lib/sync.ts` `syncCatalog` upsert it. Level updates in place and does not create a new card version, since it is metadata rather than content.
- Expose it on `v_card_health` in `db/views.sql` so admins can see the distribution.

## 2. Friendly rewrite (LLM, human-approved)
- Keep sync deterministic and reviewable: rewrites live in a checked-in file, `kb/card-copy.yaml`, keyed by card id:
  ```yaml
  rule.summary:some-key:
    sourceHash: <hash of the original source text>
    front: ...
    back: ...
    approved: false   # reviewer flips to true
  ```
- New `scripts/rewrite-cards.ts`, run as `npm run cards:rewrite`.
  - It builds the catalog, then asks an LLM to rewrite only cards that have no entry or whose `sourceHash` changed.
  - Use the AI SDK through the AI Gateway with a plain `"provider/model"` string. Load the `ai-sdk` skill before implementing.
  - Style prompt:
    - second person, short sentences, under 25 words for L1 and under 45 for L2;
    - one concrete example or analogy where it helps;
    - keep every fact, number, message text and screen name unchanged;
    - no invented rules, and no BR/MSG ids.
  - Output is validated with zod: non-empty front and back, and the back must be no longer than 1.3× the original unless the card is L3.
  - Batch the work, retry on failure, and write results into `kb/card-copy.yaml` with `approved: false`.
- In `lib/cards/build.ts` (the loader in `lib/cards/load.ts` reads the YAML): when an entry exists, is `approved: true`, and its `sourceHash` matches, use the rewritten front and back and set `generatedBy: "llm"` with `approvedBy`. Otherwise fall back to the template text. If the source changes, the rewrite goes stale and the card reverts to the template until it is regenerated.
- Compute the level from the final (rewritten) text, since that is what the learner reads.
- Also do a light pass on the templates themselves (`RULE_PROMPTS` at `build.ts:100-108`, and the concept and process fronts) so the cards that are not rewritten still sound friendlier.

## 3. UI badge
- Add `level` to `ClientCard` (built in `lib/deck.ts`; the payload is currently `{v, context, front, back, module}`).
- In `components/deck/Flashcard.tsx`, add a "Level 1/2/3" chip in the chips row (l.35–43), with a small dot or bar indicator and an `aria-label`. Use existing theme tokens and keep it readable in dark mode. Show it on the back too, if the back has a header area.
- Show the same badge on `/browse` cards, plus an optional level filter alongside `q` and `module`.
- No changes to `composeDeck`, `lib/srs.ts` or the review service.

## Critical files
`lib/cards/build.ts`, `lib/cards/load.ts`, `lib/cards/level.ts` (new), `lib/sync.ts`, `db/schema.ts`, `db/migrations/0002_card_level.sql`, `db/views.sql`, `lib/deck.ts`, `components/deck/Flashcard.tsx`, `app/(app)/browse/page.tsx`, `scripts/rewrite-cards.ts` (new), `kb/card-copy.yaml` (new), `package.json`.

## Verification
- Unit tests: `tests/level.test.ts` covers short and simple cards scoring 1, long multi-line or formula-heavy cards scoring 3, and determinism. Extend `tests/cards.test.ts` so every card has a level of 1–3 and an approved rewrite is applied only when the `sourceHash` matches. Fix the snapshot counts only if the KB changes.
- `tests/db.test.ts`: a sync stores the level, and a re-sync is idempotent without creating a version.
- Run `npm run cards:sync` and print the level histogram (it should be reasonably balanced, so tune thresholds if not). Spot-check about 10 cards per level.
- Run `npm test`, then the e2e flow (`e2e/flow.spec.ts`). Add an assertion that the badge shows on the card.
- Run the app and check the badge in light and dark themes at mobile width.
- Run `cards:rewrite` on a small sample and review the diff before approving anything.
