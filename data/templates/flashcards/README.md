# Flashcard templates

- `generation-prompt.functional.txt` - the prompt template for FUNCTIONAL (business user) cards (the former `prompt5-final.txt`). The admin UI (Admin > Cards, `lib/cards/generate/prompt.ts`) fills its `{{PLACEHOLDERS}}` and removes the operator note at the top; an operator can fill it by hand the same way.
- `generation-prompt.technical.txt` - the template for TECHNICAL cards. It does not exist yet: add it with the same placeholders and the UI enables the Technical choice by itself (until then the choice shows "soon"). Set `CARDS_TEMPLATE_DIR` to read templates from another folder.
- `catalog.template.json` - the JSON shape `npm run cards:push` reads (put real files in `data/generated-cards/`).
  - `scope`: `module` | `flow` | `form`; `key` is the KB key of that module/flow/form.
  - Card id = `gen:{key}:{audience}:{level}:{topic_key}`, so `topic_key` must be unique per group + level.
  - `source_refs`: YAML file paths, `rule:<key>`, or KB keys; they become knowledge links.
  - Points per level come from `lib/cards/spec.ts` (easy 1, medium 2, hard 3).
- `cards:push` is append-only: new cards are added, changed text becomes a new version, unchanged cards are skipped.
