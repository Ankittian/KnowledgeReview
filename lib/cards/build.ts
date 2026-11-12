import crypto from "node:crypto";
import type { KbForm, KbProcess, KbRule, KnowledgeBase } from "./load";

export type EntityType = "module" | "concept" | "rule" | "form" | "usercontrol" | "process";

export interface EntityRef {
  type: EntityType;
  key: string;
}

export interface EntityDef extends EntityRef {
  name: string;
  module: string | null;
  yamlFile: string;
  contentHash: string;
  meta: Record<string, unknown>;
}

export interface CardLinkDef extends EntityRef {
  relation: string;
}

export interface CardDef {
  id: string;
  entity: EntityRef;
  kind: string;
  sourceField: string;
  module: string | null;
  tags: string[];
  context: string;
  front: string;
  back: string;
  sourceText: string;
  sourceHash: string;
  links: CardLinkDef[];
}

export interface QualityFinding {
  entity: EntityRef;
  yamlFile: string;
  field: string;
  issue: "truncated" | "quote-artifact";
  text: string;
}

export interface Catalog {
  entities: EntityDef[];
  cards: CardDef[];
  /** structural problems (unknown references, empty cards) */
  warnings: string[];
  /** data-quality findings in the YAML itself, surfaced to admins on every sync */
  quality: QualityFinding[];
}

// ---------------------------------------------------------------- helpers

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => !k.startsWith("_"))
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export const entityKey = (r: EntityRef) => `${r.type}:${r.key}`;

/** Text for employees: drop doc cross-references (BR-07, MSG-12, "see Section 13") that mean nothing on a card. */
export function displayText(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/''/g, "'") // doubled-apostrophe artifacts from YAML quoting
    .replace(/\s*\((?:BR|MSG)-\d+(?:\s*(?:,|and|\/)\s*(?:BR|MSG)-\d+)*\)/g, "")
    .replace(/\s*\((?:see\s+)?Section\s+\d+[^)]*\)/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Body of a YAML description: without the "Evidence:" line and the Messages / Source trailers. */
function descriptionBody(desc: string | undefined): string {
  return (desc ?? "")
    .split("\n")
    .filter((l) => !/^\s*(Evidence|Messages|Source):/.test(l))
    .join("\n")
    .trim();
}

export function ruleMessages(desc: string | undefined): string[] {
  const line = (desc ?? "").split("\n").find((l) => l.startsWith("Messages:"));
  if (!line) return [];
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].trim()).filter(Boolean);
}

const RULE_PROMPTS: Record<string, (s: string) => string> = {
  calculation: (s) => `How is “${s}” calculated?`,
  control: (s) => `What does the control “${s}” enforce?`,
  default: (s) => `What default applies for “${s}”?`,
  derivation: (s) => `How is “${s}” derived?`,
  integrity: (s) => `What does the integrity rule “${s}” protect?`,
  validation: (s) => `What does the validation “${s}” check?`,
  workflow: (s) => `How does “${s}” work in the workflow?`,
};

/** Card kinds generated: business rules, business concepts and processes only (no form / code-level cards). */
export const CARD_KINDS = ["rule.summary", "concept.summary", "process.summary", "process.steps", "process.next"] as const;

/** Code-level rules, e.g. "shared-write-masterdata-x: masterdata.X is written by 2 screens." */
export function isTechnicalRule(r: KbRule): boolean {
  return r.key.startsWith("shared-write-") || /^\S+\.\S+ is (written|read) by \d+ screens?\.?$/i.test(r.summary.trim());
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- catalog

export function buildCatalog(kb: KnowledgeBase): Catalog {
  const warnings: string[] = [];
  const quality: QualityFinding[] = [];
  const entities = new Map<string, EntityDef>();
  const cards: CardDef[] = [];

  const moduleName = new Map(kb.modules.map((m) => [m.code, m.name]));
  const modName = (code?: string | null) => (code ? (moduleName.get(code) ?? code) : "General");

  const addEntity = (e: Omit<EntityDef, "contentHash">, raw: unknown) => {
    entities.set(entityKey(e), { ...e, contentHash: sha256(stableStringify(raw)) });
  };

  for (const m of kb.modules) {
    addEntity({ type: "module", key: m.code, name: m.name, module: m.code, yamlFile: "modules.yaml", meta: {} }, m);
  }
  for (const c of kb.concepts) {
    addEntity(
      { type: "concept", key: c.key, name: c.name, module: c.module ?? null, yamlFile: "concepts.yaml", meta: { tables: c.tables ?? [] } },
      c,
    );
  }
  for (const r of kb.rules) {
    const source = (r.description ?? "").split("\n").find((l) => l.startsWith("Source:"));
    addEntity(
      {
        type: "rule",
        key: r.key,
        name: r.name,
        module: null, // filled from the forms it applies to, below
        yamlFile: "rules.yaml",
        meta: {
          rule_type: r.type,
          implemented_by: r.implemented_by ?? [],
          messages: ruleMessages(r.description),
          source_ref: source?.replace(/^Source:\s*/, "").trim() ?? null,
        },
      },
      r,
    );
  }
  const formKey = (f: KbForm) => (f.form ?? f.usercontrol)!;
  const formType = (f: KbForm): EntityType => (f.form ? "form" : "usercontrol");
  const formsByKey = new Map<string, KbForm>();
  for (const f of kb.forms) {
    const key = formKey(f);
    if (!key) {
      warnings.push(`${f._file}: no form/usercontrol key, skipped`);
      continue;
    }
    formsByKey.set(key, f);
    addEntity({ type: formType(f), key, name: f.title, module: f.module ?? null, yamlFile: f._file, meta: { kind: f.kind ?? null } }, f);
  }
  for (const p of kb.processes) {
    addEntity({ type: "process", key: p.key, name: p.name, module: p.module ?? null, yamlFile: p._file, meta: { status: p.status ?? null } }, p);
  }

  /** "form:fX" / "usercontrol:QC" / "concept:x" / bare process key -> EntityRef, or null if unknown. */
  const resolve = (ref: string, fallbackType?: EntityType): EntityRef | null => {
    const [prefix, rest] = ref.includes(":") ? (ref.split(/:(.*)/s, 2) as [string, string]) : [fallbackType ?? "", ref];
    const candidates: EntityType[] =
      prefix === "form" || prefix === "usercontrol" ? ["form", "usercontrol"] : ([prefix] as EntityType[]);
    for (const t of candidates) if (entities.has(`${t}:${rest}`)) return { type: t, key: rest };
    return null;
  };
  const formRef = (key: string): EntityRef | null => resolve(`form:${key}`);
  const formTitle = (key: string) => formsByKey.get(key)?.title ?? key;

  const processesOfForm = new Map<string, Set<string>>();
  for (const p of kb.processes)
    for (const s of p.steps ?? []) {
      if (!processesOfForm.has(s.form)) processesOfForm.set(s.form, new Set());
      processesOfForm.get(s.form)!.add(p.key);
    }

  const pushCard = (c: Omit<CardDef, "sourceHash" | "links"> & { links: (CardLinkDef | null)[] }, ctx: string) => {
    const seen = new Set<string>();
    const links: CardLinkDef[] = [];
    for (const l of c.links) {
      if (!l) continue;
      const k = `${l.type}:${l.key}:${l.relation}`;
      if (seen.has(k) || (l.type === c.entity.type && l.key === c.entity.key)) continue;
      seen.add(k);
      links.push(l);
    }
    if (!c.back.trim()) {
      warnings.push(`${ctx}: empty back text, card skipped`);
      return;
    }
    const yamlFile = entities.get(entityKey(c.entity))?.yamlFile ?? "";
    if (/:\s*$/.test(c.sourceText.trim()) && !c.kind.startsWith("process."))
      quality.push({ entity: c.entity, yamlFile, field: c.sourceField, issue: "truncated", text: c.sourceText.trim().slice(-120) });
    if (c.sourceText.includes("''")) quality.push({ entity: c.entity, yamlFile, field: c.sourceField, issue: "quote-artifact", text: c.sourceText.slice(0, 120) });
    cards.push({ ...c, links, sourceHash: sha256([c.context, c.front, c.back, c.sourceText].join("\n␞\n")) });
  };
  const link = (ref: EntityRef | null, relation: string, ctx: string, raw: string): CardLinkDef | null => {
    if (!ref) {
      warnings.push(`${ctx}: unknown reference '${raw}'`);
      return null;
    }
    return { ...ref, relation };
  };
  const processLinks = (formK: string) =>
    [...(processesOfForm.get(formK) ?? [])].map((p) => ({ type: "process" as const, key: p, relation: "in_process" }));

  // ---- rules ------------------------------------------------------------------------------------
  for (const r of kb.rules) {
    const ctx = `rules.yaml#${r.key}`;
    const formRefs = (r.applies_to ?? []).filter((a) => a.startsWith("form:") || a.startsWith("usercontrol:"));
    const formKeys = formRefs.map((a) => a.split(":")[1]);
    const primaryForm = formKeys[0] ? formsByKey.get(formKeys[0]) : undefined;
    const module = primaryForm?.module ?? kb.processes.find((p) => p.key === r.processes?.[0])?.module ?? null;
    const ent = entities.get(`rule:${r.key}`)!;
    ent.module = module;
    if (isTechnicalRule(r)) continue; // code-level (which screens write a table): not a business rule card

    const [prefix, short] = r.name.includes(": ") ? (r.name.split(/: (.*)/s, 2) as [string, string]) : [null, r.name];
    const where = prefix ?? (primaryForm ? primaryForm.title : "General");
    const messages = ruleMessages(r.description);
    const prompt = (RULE_PROMPTS[r.type] ?? ((s: string) => `What does the rule “${s}” say?`))(short);
    let back = displayText(r.summary);
    if (messages.length) back += `\n\nMessages shown:\n${messages.map((m) => `• “${m}”`).join("\n")}`;

    pushCard(
      {
        id: `rule.summary:${r.key}`,
        entity: { type: "rule", key: r.key },
        kind: "rule.summary",
        sourceField: "summary",
        module,
        tags: [`rule-type:${r.type}`],
        context: `${where} · ${cap(r.type)} rule`,
        front: prompt,
        back,
        sourceText: r.summary,
        links: [
          ...(r.applies_to ?? []).map((a) =>
            link(resolve(a), a.startsWith("concept:") ? "applies_to_concept" : "applies_to_form", ctx, a),
          ),
          ...(r.processes ?? []).map((p) => link(resolve(p, "process"), "in_process", ctx, p)),
          ...formKeys.flatMap(processLinks),
        ],
      },
      ctx,
    );
  }

  // ---- concepts ---------------------------------------------------------------------------------
  const formsManaging = new Map<string, string[]>();
  for (const f of kb.forms)
    for (const c of f.manages ?? []) {
      if (!formsManaging.has(c)) formsManaging.set(c, []);
      formsManaging.get(c)!.push(formKey(f));
    }
  const processesOfConcept = new Map<string, string[]>();
  for (const p of kb.processes)
    for (const c of p.concepts ?? []) {
      if (!processesOfConcept.has(c)) processesOfConcept.set(c, []);
      processesOfConcept.get(c)!.push(p.key);
    }
  for (const c of kb.concepts) {
    const ctx = `concepts.yaml#${c.key}`;
    const syn = (c.synonyms ?? []).filter((s) => s && s !== c.name);
    pushCard(
      {
        id: `concept.summary:${c.key}`,
        entity: { type: "concept", key: c.key },
        kind: "concept.summary",
        sourceField: "summary",
        module: c.module ?? null,
        tags: ["concept"],
        context: `Business concept · ${modName(c.module)}`,
        front: `What is “${c.name}”?${syn.length ? `\n(also called ${syn.join(", ")})` : ""}`,
        back: displayText(c.summary),
        sourceText: c.summary ?? "",
        links: [
          ...(c.related_to ?? []).map((r) => link(resolve(`concept:${r.concept}`), "related_concept", ctx, r.concept)),
          ...(c.parent_of ?? []).map((p) => link(resolve(`concept:${p}`), "parent_of_concept", ctx, p)),
          ...(formsManaging.get(c.key) ?? []).map((f) => link(formRef(f), "managed_by_form", ctx, f)),
          ...(processesOfConcept.get(c.key) ?? []).map((p) => link(resolve(p, "process"), "in_process", ctx, p)),
        ],
      },
      ctx,
    );
  }

  // ---- processes ----------------------------------------------------------------------------------
  for (const p of kb.processes) {
    const ctx = p._file;
    const steps = [...(p.steps ?? [])].sort((a, b) => a.order - b.order);
    const stepLinks = steps.map((s) => link(formRef(s.form), "has_step", ctx, s.form));
    const conceptLinks = (p.concepts ?? []).map((c) => link(resolve(`concept:${c}`), "uses_concept", ctx, c));
    const base = { entity: { type: "process" as const, key: p.key }, module: p.module ?? null };
    const context = `Business process · ${modName(p.module)}`;

    pushCard(
      {
        ...base,
        id: `process.summary:${p.key}`,
        kind: "process.summary",
        sourceField: "summary",
        tags: ["process"],
        context,
        front: `What is the “${p.name}” process about?`,
        back: [displayText(p.summary), displayText(descriptionBody(p.description))].filter(Boolean).join("\n\n"),
        sourceText: [p.summary ?? "", descriptionBody(p.description)].join("\n\n").trim(),
        links: [...stepLinks, ...conceptLinks],
      },
      ctx,
    );
    pushCard(
      {
        ...base,
        id: `process.steps:${p.key}`,
        kind: "process.steps",
        sourceField: "steps",
        tags: ["process"],
        context,
        front: `What are the steps of “${p.name}”?`,
        back: steps.map((s, i) => `${i + 1}. ${s.name} — ${formTitle(s.form)}`).join("\n"),
        sourceText: steps.map((s) => `${s.order}. ${s.name} (${s.form})`).join("\n"),
        links: stepLinks,
      },
      ctx,
    );
    steps.slice(0, -1).forEach((s, i) => {
      const next = steps[i + 1];
      pushCard(
        {
          ...base,
          id: `process.next:${p.key}:${s.order}`,
          kind: "process.next",
          sourceField: `steps[${next.order}]`,
          tags: ["process", "sequence"],
          context: `${p.name} · Step ${i + 1} of ${steps.length}`,
          front: `In “${p.name}”, what comes after “${s.name}”?`,
          back: `${next.name}\n(on the ${formTitle(next.form)} screen)`,
          sourceText: `${next.order}. ${next.name} (${next.form})`,
          links: [link(formRef(s.form), "has_step", ctx, s.form), link(formRef(next.form), "has_step", ctx, next.form)],
        },
        `${ctx}#steps[${s.order}]`,
      );
    });
  }

  // card ids must be unique
  const ids = new Set<string>();
  for (const c of cards) {
    if (ids.has(c.id)) warnings.push(`duplicate card id ${c.id}`);
    ids.add(c.id);
  }
  return { entities: [...entities.values()], cards, warnings, quality };
}

export type { KbProcess };
