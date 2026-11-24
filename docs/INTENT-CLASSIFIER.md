# Intent classifier (jev)

A switchable layer in front of the Knowledge Assistant. Every question is checked by TypeSafe AI's **jev** decision
model before the Claude agent runs. A question that fails a check is refused with a short fixed message; Claude and the
knowledge-base MCP are never called for it. With `CLASSIFIER_ENABLED=false` (the default) the layer is fully off and the
chat behaves exactly as before.

The code lives in `lib/chat/intent/` (contract: `types.ts`). The check is called from `execute()` in `lib/chat/live.ts`,
before the runner starts (see [CHAT-HARNESS.md](CHAT-HARNESS.md) §3a).

## What is checked

jev answers one yes/no question per check and returns a probability for each. A check is **flagged** when its probability is
at or above its threshold (default 0.5). The blocked category is the flagged check with the highest probability.

| Check (category) | jev question key | Flags |
|---|---|---|
| `sql_injection` | `is_sql_injection` | Injection payloads (`' OR 1=1--`, `UNION SELECT`, `; DROP`) and requests to run arbitrary or bulk-dump queries ("run this cypher…", "dump all nodes/users"). A technical user asking what a SQL snippet does, or how to query a SpectrumERP table, is allowed. |
| `jailbreak` | `is_jailbreak` | Instruction overrides, personas or role-play to drop the rules, system-prompt extraction, asking to switch tokens or roles, multi-turn set-ups. |
| `out_of_domain` | `is_out_of_domain` | Anything that is not SpectrumERP. Allowed: SpectrumERP itself, general ERP / accounting / business-process concepts ("what is a GRN?"), greetings, "what can you do", how to use the chat, and general SQL/.NET only when tied to SpectrumERP. |
| `restricted_object` | `asks_restricted_object` | The question *directly* asks for a table, stored procedure, function, trigger, view, column, code block, SQL/query, or file path/folder. Business questions pass ("why did my GRN posting fail?"). |

Which checks run depends on the conversation:

| Conversation | Check set | Checks |
|---|---|---|
| **Functional** answer role on either KB (SpectrumERP-new: the functional MCP token), user is **not an admin** | `common+functional` | sql_injection, jailbreak, out_of_domain, restricted_object |
| Everything else: technical and product answer roles, and admins | `common` | sql_injection, jailbreak, out_of_domain |

The check role comes from `tokenRoleFor(role)` in `lib/chat/config.ts`: the token role on SpectrumERP-new, and the same mapping
for the old single-token SpectrumERP KB (functional stays functional; technical and product count as technical). `restricted_object` only exists to protect
functional users, so technical users and admins can ask for technical detail.

**Input to jev:** the latest question plus the two previous *user* questions (no assistant turns). Each earlier question is
cut to 1000 characters, the latest to 4000.

## Refusals

| Category | Message shown |
|---|---|
| `out_of_domain` | I can only help with SpectrumERP — for example processes, screens, reports and how things are calculated. |
| `restricted_object` | That's technical detail I can't share for your role. Try asking about the business process instead, or ask a technical colleague. |
| `sql_injection`, `jailbreak` | I can't help with that. |
| classifier failure in `enforce` mode | I couldn't check that message — please try again. |

A refused turn is saved like any other: the user row, plus an assistant row that completes with the refusal text and
`chat_messages.blocked_category` (a category, or `classifier_error`). **Blocked questions count toward the daily limit.**

## Configuration

All in the environment (`.env`; see `.env.example`). Changing them needs an app restart
(`docker compose --profile app up -d`).

| Variable | Default | Meaning |
|---|---|---|
| `CLASSIFIER_ENABLED` | `false` | `true` turns the layer on. Enabled without `CLASSIFIER_API_KEY` is treated as disabled. |
| `CLASSIFIER_MODE` | `shadow` | `shadow`: log only, never block, classifier failures never block. `enforce`: flagged questions are refused; a classifier failure also refuses ("please try again"). |
| `CLASSIFIER_API_KEY` | empty | TypeSafe AI API key. Used only by the app server; it is never passed into the Claude process environment. |
| `CLASSIFIER_MODEL` | `jev-1.14.0` | jev model name. |
| `CLASSIFIER_BASE_URL` | `https://api.typesafe.ai/v1/systemone` | API base URL. |
| `CLASSIFIER_TIMEOUT_MS` | `3000` | Time allowed for one classification. A timeout is a classifier failure. |
| `CLASSIFIER_THRESHOLDS` | empty (0.5 each) | JSON map of per-check thresholds, e.g. `{"jailbreak":0.4,"out_of_domain":0.7}`. Keys: `sql_injection`, `jailbreak`, `out_of_domain`, `restricted_object`. |

## Rollout: shadow, then enforce

1. **Shadow.** Set `CLASSIFIER_ENABLED=true`, `CLASSIFIER_MODE=shadow` and the API key. Nothing is blocked; every question is
   scored and logged with outcome `allowed` or `would_block`.
2. **Review.** Look at the `chat_classified` rows (below) for a week or two: how many `would_block`, in which category, and
   whether they were right. Open the matching chats in Admin → All chats. Tune `CLASSIFIER_THRESHOLDS` (raise a threshold
   for a check that flags too much) and re-run the evaluation set (below).
3. **Enforce.** Set `CLASSIFIER_MODE=enforce`. Flagged questions are now refused. Watch the **Blocked** filter in Admin → All
   chats and the `classifier_error` rate; a high error rate means a timeout or key problem and users see "please try again".
4. **Back out any time:** set `CLASSIFIER_MODE=shadow` (keeps logging) or `CLASSIFIER_ENABLED=false` (fully off), restart.

## Logging and review

Every classification, except outcome `disabled`, writes one `activity_log` row with action `chat_classified` and details:

```json
{ "conversationId": "…", "messageId": 123, "tokenRole": "functional", "checkSet": "common+functional",
  "category": null, "scores": { "sql_injection": 0.01, "jailbreak": 0.02, "out_of_domain": 0.03, "restricted_object": 0.04 },
  "model": "jev-1.14.0", "latencyMs": 412, "mode": "shadow", "outcome": "allowed" }
```

`outcome` is `allowed`, `blocked` (enforce), `would_block` (shadow) or `error` (then `error` holds the reason, e.g.
`timeout`, `http_500`, `bad_output`). The question text is **not** logged here: it is already in `chat_messages` and the
`chat_prompt` event.

```sql
-- would-be / actual blocks in the last 7 days, by category
SELECT details->>'category' AS category, details->>'outcome' AS outcome, count(*)
FROM activity_log
WHERE action = 'chat_classified' AND created_at > now() - interval '7 days' AND details->>'category' IS NOT NULL
GROUP BY 1, 2 ORDER BY 3 DESC;
```

In the admin area: **All chats → Blocked** filters conversations with a refused answer (any, or one category,
including `classifier_error`), and the transcript shows a `blocked: <category>` badge on each refused answer.

## Evaluation

`npm run intent:eval` runs a labelled set of questions through the real classifier and reports per-check precision/recall and
the questions it got wrong. It needs `CLASSIFIER_API_KEY` and costs jev calls. Run it after changing thresholds, the
check definitions or the model version, and before moving from shadow to enforce.

## Database

`chat_messages.blocked_category` (nullable text): `sql_injection`, `jailbreak`, `out_of_domain`, `restricted_object`,
`classifier_error`, or NULL for an answered question. Added by `db/migrations.sql` (idempotent) and `db/schema.sql`.

## Disabling

Set `CLASSIFIER_ENABLED=false` (or leave it unset) and restart. No code path of the layer runs; no `chat_classified` rows are
written. Existing `blocked_category` values stay on old messages.
