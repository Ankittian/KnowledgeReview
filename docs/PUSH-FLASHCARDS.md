# Pushing generated flashcards into Postgres

How to load the JSON catalogs in `data/generated-cards/` into the database. One command does the whole push: `npm run cards:push`.

## 1. What goes in

One JSON file per **module and audience**, in `data/generated-cards/`, for example `MM.forms-common.functional.json`. The script reads every `*.json` in that folder, or only the files you name.

```json
{
  "module": "MM",
  "title": "Materials Management",
  "audience": "functional",
  "total_cards": 264,
  "items": [
    {
      "scope": "flow",
      "key": "procure-to-pay",
      "title": "Procure to Pay",
      "context": "Short description shown with the cards.",
      "cards": [
        {
          "level": "easy",
          "topic_key": "procure-to-pay-overview",
          "title": "Front of the card (the question or statement)",
          "body": "Back of the card (the answer).",
          "source_refs": ["Procure to Pay (process:procure-to-pay)", "Some Rule Name (rule:some-rule-key)"]
        }
      ]
    }
  ]
}
```

| Field | Rules |
|---|---|
| `module` | Module code, for example `MM`, `PM`. Required. |
| `audience` | `functional` or `technical`. Required. |
| `items[].scope` | `module`, `flow` or `form`. Decides the KB item type when one has to be created (`module`, `process`, `form`). |
| `items[].key` | Key of the KB item the cards belong to. Reused if it exists, created if not. |
| `cards[].level` | `easy`, `medium` or `hard`. |
| `cards[].topic_key` | Unique per group and level. Part of the card id. |
| `cards[].title` / `body` | Front and back of the card. Required, not empty. |
| `cards[].source_refs` | Optional. Graph nodes written as `<node name> (<node id>)`, for example `Purchase Order (form:fPurchaseOrder)`. KB yaml files, bare `rule:<key>` and plain keys are still accepted. Each one that is found becomes a `source` link. |

A card id is `gen:<key>:<audience>:<level>:<topic_key>`. Pushing the same card again finds the same id, so a re-push never creates duplicates.

## 2. Before you push (once per environment)

1. **Database running and `.env` set.** `DATABASE_URL` must point at the database the app uses (`npm run db:up` starts the Docker Postgres).
2. **Tables created:** `npm run db:init` (creates them on an empty database)
3. **Knowledge base loaded:** `npm run cards:sync -- --entities-only`. This reads the YAML in `kb/` into `kb_items` (without the old template cards). Without it the push still works, but `source_refs` cannot be resolved and you get no knowledge links.

## 3. Push

Always preview first. `--dry-run` runs everything inside a transaction and rolls it back, so nothing is saved:

```bash
npm run cards:push -- --dry-run
```

Then push for real:

```bash
npm run cards:push                              # every file in data/generated-cards/
npm run cards:push -- data/generated-cards/MM.forms-common.functional.json   # one file (relative to the project root)
npm run cards:push -- data/generated-cards/<file1>.json data/generated-cards/<file2>.json
```

### Append or purge

| Mode | Command | What it does |
|---|---|---|
| **append** (default) | `npm run cards:push` | Inserts new cards. A card whose text changed gets a **new version** (old versions and the reviews on them stay). Unchanged cards are skipped. Nothing is deleted, so reviews, feedback, schedules and leaderboard points are kept. Safe to run repeatedly. |
| **purge** | `npm run cards:push -- --mode purge` | First deletes the module's cards for the catalog's **audience**, together with their reviews, feedback, deck entries, review schedule, links and versions. Then inserts the catalog. |
| purge, whole module | `npm run cards:push -- --mode purge --scope module` | Same, but deletes **every** card of the module, legacy cards and the other audience included. |

`--append` and `--purge` are shorthands for `--mode append` and `--mode purge`.

**Purge deletes users' review history on those cards and cannot be undone.** Use it when a catalog has been regenerated from scratch and the old cards must go. Run `--mode purge --dry-run` first to see how many cards would be deleted.

Each file is pushed in a single transaction: if anything fails, that file leaves the database exactly as it was.

### Checks the push makes before it writes anything

A card's id only catches an exact repeat. So every push also checks the cards in the file:

| Check | What it finds | Real push | `--dry-run` |
|---|---|---|---|
| **Repeated topic** | A new card whose title shares about 60 percent of its key words with a stored card of the **same item** (any level), or with another new card in the file. Filler words, plurals and British/American spelling are ignored. | **Refused**, nothing is saved | Reported |
| **Revised card** | A card that already exists (same id) with different text. It would get a new version. | Reported (refused with `--no-revisions`) | Reported |
| **Unresolved source_refs** | A `source_refs` entry that matches no knowledge-base item, so the card has no link to it. | Reported, the card is still saved | Reported |

Options:

```bash
npm run cards:push -- --allow-duplicates        # report repeated topics but push anyway
npm run cards:push -- --similarity 0.7          # how close two titles must be (0 to 1, default 0.6)
npm run cards:push -- --no-duplicate-check      # skip the title comparison
npm run cards:push -- --no-revisions            # refuse if any card would be replaced by a new version
```

### The ledger: what is already taught

The generation prompt (`docs/prompts/prompt5.txt`) needs the titles already in the database so it does not repeat them. Export them (titles only, never bodies):

```bash
npm run cards:ledger -- --module MM                          # every functional card of the module
npm run cards:ledger -- --module MM --items fGRN,fGateEntry  # only the items of this run
npm run cards:ledger -- --module MM --audience technical --out ledger.txt
```

Each line is `<item key> | <level> | <topic_key> | <title>`. Paste it into `{{EXISTING_CARDS}}`.

### Common (cross-form) cards

A card that is not about one form goes under a `flow` item (or a `module` item). The push creates that item on first use (type `process`, marked generated, with the catalog's module). Item lookup is by type **and** key, so a flow is never attached to a form that has the same key. On the Browse screen two buttons sit above the filters: **Form questions** (cards that sit on a form) and **Common questions** (cards that sit on a flow or a module). The Form dropdown is shown only under Form questions; Common questions has no dropdown. Clicking the active button turns it off and shows all cards. Each button shows its card count and is disabled when there are none. Under Form questions a form's count and list include only form cards, so common cards that cite the form in `source_refs` are found under Common questions instead.

## 4. Read the output

```
Processing: data/generated-cards\MM.forms-common.functional.json
Module: MM | Audience: functional | Total Cards: 264
MM: 3 new, 5 updated (new version), 256 unchanged, 12 knowledge links.
```

- **new**: cards that did not exist.
- **updated (new version)**: cards whose text changed.
- **unchanged**: cards identical to what is in the database.
- **knowledge links**: new `source` links to KB items. `0` on a re-push is normal, the links already exist.
- **purged N**: shown in purge mode, the number of cards deleted first.

The run ends with a table of cards by module, audience and level, and `Total Active Cards` / `card_health rows` (these two should match).

## 5. Check the result

```bash
npm run db:query -- "select i.module, c.audience, c.level, count(*) from cards c join kb_items i on i.id = c.kb_item_id group by 1,2,3 order by 1,2,3"
npm run db:query -- "select count(*) from card_related_items"
```

Then open the app (Today, Browse) as a user whose answer style matches the audience.

## 6. Troubleshooting

| Message | Cause and fix |
|---|---|
| `No JSON card catalog files found to process.` | The folder is empty or the path is wrong. Run from the project root. |
| `File not found: ..., skipping.` | A path you passed does not exist. The other files are still processed. |
| `<file>: not valid JSON` | Syntax error in the file. The message names the problem. |
| `<file>: invalid catalog` followed by a path | A field is missing or has a wrong value, for example `level` not `easy`, `medium` or `hard`. The first five problems are listed. |
| `duplicate card id ...` | Two cards in the same group share `level` and `topic_key`. Make the `topic_key` unique. |
| `DATABASE_URL is not set` | Set it in `.env`. |
| `relation ... does not exist` or `column ... does not exist` | The tables are missing or older than the code. On an empty database run `npm run db:init`. |
| `0 knowledge links` on a first push | `kb_items` is empty or has no matching keys. Run `npm run cards:sync -- --entities-only`, then push again in append mode. Existing cards stay unchanged and the missing links are added. |
| `--mode must be append or purge` | Typo in the option. `npm run cards:push -- --help` lists them. |

## 7. Where the code is

- `scripts/push-cards.ts`: the command line (options and report).
- `lib/cards/push/catalog.ts`: file discovery, validation, the JSON schema.
- `lib/cards/push/purge.ts`: the purge.
- `lib/cards/push/kb-items.ts`: finding and creating KB items, resolving `source_refs`.
- `lib/cards/push/cards.ts`: inserting cards and versions, creating links.
- `lib/cards/push/index.ts`: `pushCatalog()`, which runs one file in a transaction.
