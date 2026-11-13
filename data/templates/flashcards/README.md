# Flashcard templates

- `generation-prompt.txt` - the prompt used to have an LLM generate one `<MODULE>.functional.json` per module from `kb/`.
- `catalog.template.json` - the JSON shape `npm run cards:push` reads (put real files in `data/generated-cards/`).
  - `scope`: `module` | `flow` | `form`; `key` is the KB key of that module/flow/form.
  - Card id = `gen:{key}:{audience}:{level}:{topic_key}`, so `topic_key` must be unique per group + level.
  - `source_refs`: YAML file paths, `rule:<key>`, or KB keys; they become knowledge links.
  - Points per level come from `lib/cards/spec.ts` (easy 1, medium 2, hard 3).
- `cards:push` is append-only: new cards are added, changed text becomes a new version, unchanged cards are skipped.
