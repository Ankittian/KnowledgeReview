# Plan: a flow-first card ladder (module → flow → form)

Status: **draft, waiting on the open questions in section 9.** Builds on `PLAN-flashcards-roles-scoring.md` (roles, weights 1/3/5, auto-publish). Replaces its section 4.1 ("levels cover the same form at three depths").

## 1. The problem

The 61 cards generated so far are **form-specific at every level**. An Easy card is "what the Expense Advance records"; a Hard card is "date checks on a down period". A new employee cannot learn *how the ERP fits together* from them, and an Easy card is not easy because it assumes you already know which form is meant.

## 2. The ladder

Difficulty becomes **depth of the flow**, not length of text about one form.

| Level | Weight | Scope | The card answers | Attached to (existing table, no new column) |
|---|---|---|---|---|
| **Easy** | 1 | **Module**: the ERP flow at module level | What is this module for? Which business flows does it run? What does it receive from and hand to other modules? | the module's `kb_item` |
| **Medium** | 3 | **Flow (process)**: one business flow, step by step | In what order do the documents happen? What does each step hand to the next? Where does the flow leave this module? | the process's `kb_item` |
| **Hard** | 5 | **Form**: one screen, placed inside its flow | What does this form take from the step before, which rules and checks apply, what does it change, what goes wrong? | the form's `kb_item` (as today) |

Because `kb.kb_items` already holds modules, processes and forms, a card's scope is just the type of the item it is attached to. No schema change is needed beyond what exists.

Example for Materials Management (functional):

- Easy: "Materials Management covers buying, receiving and storing material. A department's need is raised, goes through quotations to a purchase order, and the goods are received and stored. The cost of what is received passes to Finance."
- Medium: "In the purchase flow a material request becomes a purchase request, the buyer asks vendors for quotations, compares them, and only then creates the purchase order. The goods are recorded at the gate before the receipt note."
- Hard: "The Material Receipt Note records what was actually received against the order. It cannot accept more than the order quantity plus the allowed tolerance. …" (form-level rules, as today, but starting from where the form sits in the flow).

## 3. What the knowledge base gives us (checked)

| | MM | PM | FI |
|---|---|---|---|
| Processes | 31 | 6 | 10 |
| **Real, named flows** with 4+ ordered steps and hand-offs (`leads_to`) | procure-to-pay (10 steps), goods-receipt-quality-inspection (10), material-master-setup (12), vendor-master-setup (6), inventory-storage (5) | preventive-maintenance (4 steps, only 2 in PM) | payment-flow (7), finance-master-setup (9), gst-tax-determination (8) |
| Generated groupings, not flows | 26 small `pN-…` buckets of 1–3 steps | 5 `p11-eam-…` buckets of 5–22 screens | 7 `p12-finance-…` buckets of 4–23 screens |
| Forms that appear in some process | 87 of 98 | 60 of 60 | 100 of 112 |

What this means:

- **Easy and Medium are strong for MM and FI, thin for PM.** PM has one real flow. Its other processes are lists of screens grouped by area (equipment register, work orders, service calls), not sequences.
- For a grouping that is not a flow, Medium cards describe **what the group is for and how its screens relate** (for example "equipment is registered first, then maintenance is requested and scheduled against it"), and never invent a sequence the KB does not state. Where the KB gives no order, there is no order card.
- Hand-offs between flows (`leads_to`: procure-to-pay → goods receipt → payment) give the cross-module Easy cards.

## 4. Content rules per level and audience

| | Functional | Technical |
|---|---|---|
| **Easy** (module) | Purpose of the module in business words; its main flows in plain order; what it takes in from and passes to other modules; key documents by **business name** (purchase order, receipt note). No form codes, no screen mechanics. | The module's technical footprint: which areas of data it owns, the shared masters it depends on, how it connects to other modules (what a hand-off physically is). Names tables/areas only when they appear in the evidence. |
| **Medium** (flow) | One flow end to end: the order of documents, who performs each step, what each hands on, where approval or a hand-off to another module happens. | The data trail of a flow: how one document references the next, which routines or reference lists link them, what posts where. |
| **Hard** (form) | The form's role in its flow, business rules and calculations in plain words, refusals and warnings, effects on stock and accounts, edge cases. **Starts from the flow position**, then goes into rules. | Validations with conditions, routines, tables and procedures, posting and stock effects, edge cases (today's technical cards). |

The existing leak check, grounding check and "no padding" rule apply unchanged. Two additions:

- Easy and Medium functional cards may name a form **only by its display title or plain business name**, never its code.
- A **flow card must follow the KB's step order exactly**; the validator compares any "A, then B, then C" in the body against the process's step list and rejects an out-of-order or invented step.

## 5. Evidence bundles (new, one per scope)

| Bundle | Built from | Contents |
|---|---|---|
| **Module bundle** | `modules.yaml`, the module's processes, `leads_to`, concepts | Module summary and description; list of its flows with their summaries; hand-offs to other modules; the main concepts |
| **Flow bundle** | one `processes/*.yaml` + forms in its steps | Ordered steps (step name, form **title**, who uses it), the process summary and description, concepts, `leads_to`, rules whose `processes` list names the flow |
| **Form bundle** | existing form bundle | Existing content, plus `position_in_flow` (flow name, step number, previous and next form titles) so Hard cards can start from it |

Functional and technical variants of each are split exactly as today, so the functional generator never sees technical detail.

## 6. Card budget (replaces the 5 / 8 / 10 per form ceiling)

| Level | Ceiling | Typical total for MM + PM + FI |
|---|---|---|
| Easy | up to 8 per module | ~3 modules × ~6 = ~20 per audience |
| Medium | up to 6 per flow (named flows), up to 3 per grouping | ~20 flows × ~5 = ~100 per audience |
| Hard | up to 10 per form | all forms: up to ~2,700 per audience; **main-flow forms only: ~35 forms ≈ 350** |

Easy and Medium are small sets that every user will actually finish. Hard is where volume lives, so its scope is a decision (question 3).

## 7. App changes

- **Scope chip and breadcrumb** on each card: `MM › Procure-to-Pay › Material Receipt Note`, so the user always sees where they are in the flow.
- **Browse filters** become module → flow → form (instead of module only), plus level and audience.
- **Daily deck order** (option, question 5): Easy first, then Medium, then Hard, so a new user learns the big picture before the detail. Weights stay 1 / 3 / 5.
- No change to scoring, roles, audience separation or the answer buttons.

## 8. Phases

| Step | What | Output |
|---|---|---|
| 1 | Answer the open questions | Final scope |
| 2 | Build module, flow and form-position bundles; add flow-order check to the validator | `generated-cards/_bundles/` (new kinds) |
| 3 | **Pilot on MM**: module cards, procure-to-pay and goods-receipt flows, Hard cards for their forms (functional + technical) | JSON for you to review |
| 4 | Review and tune wording | Approved style |
| 5 | Run PM and FI the same way | JSON |
| 6 | Load into Postgres (replace the current 61 per question 4), update browse filters and breadcrumb | Visible in the app |

## 9. Decisions (from your answers)

| # | Question | Decision |
|---|---|---|
| 1 | Card format | **Statement to verify** at every level (current player, Known / New / Incorrect). |
| 2 | Technical set | **Skipped for now.** Only functional cards are generated in this round. The technical ladder is left for later. |
| 3 | Hard scope | **Main-flow forms first**: only forms that appear in the named flows. |
| 4 | The 61 existing cards | **Replaced.** They are retired when the new ladder is loaded into Postgres (not before; nothing changes in the app until you have reviewed the JSON). |
| 5 | Deck order | Not asked; **mixed as today** unless you say otherwise. |

Consequences: the ladder in section 2 is built for the **functional** audience only. The existing technical cards are not touched until a technical round is planned; they are retired only if you later ask for it.

## 10. What is being built first (pilot: MM)

1. Module bundle for MM; flow bundles for the named MM flows; form bundles (existing) for the forms in them.
2. Cards: **Easy** attached to the module, **Medium** to each named flow, **Hard** to each form in a named flow.
3. Output is JSON in `generated-cards/` for your review. Nothing is loaded into Postgres and no card is retired until you approve it.
