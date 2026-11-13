/**
 * The flashcard contract: levels, weights, length limits and the functional-card leak check.
 * Shared by the generator tooling (scripts/cards/*) and, later, the app (read-time lock, scoring).
 */

export type Level = "easy" | "medium" | "hard";
export type Audience = "functional" | "technical";

export const LEVELS: Record<Level, { weight: number; words: [number, number]; lines: [number, number]; ceiling: number }> = {
  // weight = points a card of this level earns for a correct answer: easy 1, medium 2, hard 3
  easy: { weight: 1, words: [20, 70], lines: [3, 4], ceiling: 5 },
  medium: { weight: 2, words: [90, 200], lines: [6, 10], ceiling: 8 },
  hard: { weight: 3, words: [180, 380], lines: [10, 20], ceiling: 10 },
};
export const LEVEL_ORDER: Level[] = ["easy", "medium", "hard"];

/**
 * The flow-first ladder (docs/plans/PLAN-flashcards-flow-ladder.md): difficulty = depth of the ERP flow.
 *   module -> easy   (what the module is for, its flows, hand-offs to other modules)
 *   flow   -> medium (one business flow, step by step)
 *   form   -> hard   (one form placed inside its flow: rules, checks, effects)
 * A card file that declares a `scope` follows this ladder; files without a scope are the older per-form cards.
 */
export type Scope = "module" | "flow" | "form";
export const SCOPE_LEVEL: Record<Scope, Level> = { module: "easy", flow: "medium", form: "hard" };
export const SCOPE_CEILING: Record<Scope, number> = { module: 8, flow: 6, form: 10 };

/**
 * Master switch for the read-time lock (countdown, disabled answer buttons, server refusal of early answers).
 * OFF for now: cards can be answered at once. Time on the card is still recorded. Set to true to enforce it again.
 */
export const READ_LOCK_ENABLED = false;

/** A card cannot be answered before this many seconds have passed since it was shown (words ÷ 5 per second, min 4). */
export const READ_WORDS_PER_SECOND = 5;
export const READ_MIN_SECONDS = 4;
export const minReadSeconds = (wordCount: number) => Math.max(READ_MIN_SECONDS, Math.ceil(wordCount / READ_WORDS_PER_SECOND));

export const countWords = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
export const countLines = (s: string) => s.split(/\r?\n/).filter((l) => l.trim()).length;

/**
 * Things a business user must never see in a functional card. Each entry is [label, regex].
 * Keep this list in sync with the functional skill's "forbidden" list (docs/plans/PLAN-flashcards-roles-scoring.md, section 3).
 */
export const FUNCTIONAL_FORBIDDEN: [string, RegExp][] = [
  ["form code (fXxx / mXxx / tXxx)", /\b[fmt][A-Z][A-Za-z]+\b/],
  ["schema.table name", /\b[A-Za-z]+\.[A-Za-z]{3,}\b/],
  ["rule/message id", /\b(BR|MSG|VAL)[-_ ]?\d+\b/i],
  ["stored procedure / SQL word", /\b(stored procedures?|sp_|SQL|query|queries|schema|database|db)\b/i],
  ["table/column word", /\b(table|tables|column|columns|dataset)\b/i],
  ["code-level word", /\b(method|methods|API|backend|back-end|source code|the code|code level|stored|posting key)\b/i],
  ["UI control word", /\b(drop-?down|text ?box|check ?box|radio button|grid|popup|pop-up|tab|tabs|toolbar|button|combo|icon)\b/i],
  ["field length / format", /\(\d+\)|\b\d+\s*(characters?|chars|decimals?|digits?)\b/i],
  ["keyboard shortcut", /\b(Ctrl|Alt|Shift)\s*\+/i],
  ["camelCase / snake_case identifier", /\b[a-z]+[A-Z][A-Za-z]*\b|\b[a-z]+_[a-z_]+\b/],
];

export function functionalLeaks(text: string): string[] {
  const out: string[] = [];
  for (const [label, re] of FUNCTIONAL_FORBIDDEN) {
    const m = text.match(re);
    if (m) out.push(`${label}: "${m[0]}"`);
  }
  return out;
}
