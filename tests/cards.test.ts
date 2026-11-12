import { describe, expect, it } from "vitest";
import { CARD_KINDS, buildCatalog, displayText, entityKey, isTechnicalRule, ruleMessages } from "@/lib/cards/build";
import { loadKnowledgeBase } from "@/lib/cards/load";

const kb = loadKnowledgeBase("kb");
const catalog = buildCatalog(kb);
const count = (kind: string) => catalog.cards.filter((c) => c.kind === kind).length;

describe("card catalog from the YAML knowledge base", () => {
  it("has one card per business rule, concept and process, and no form-level cards", () => {
    const businessRules = kb.rules.filter((r) => !isTechnicalRule(r));
    expect(count("rule.summary")).toBe(businessRules.length);
    expect(count("concept.summary")).toBe(kb.concepts.length);
    expect(count("process.steps")).toBe(kb.processes.length);
    expect(count("process.summary")).toBe(kb.processes.length);
    const steps = kb.processes.reduce((n, p) => n + p.steps.length - 1, 0);
    expect(count("process.next")).toBe(steps);
    expect(catalog.cards.filter((c) => c.kind.startsWith("form.")).length).toBe(0);
    expect(new Set(catalog.cards.map((c) => c.kind))).toEqual(new Set(CARD_KINDS));
  });

  it("skips code-level rules (which screens write a table)", () => {
    const tech = kb.rules.filter(isTechnicalRule);
    expect(tech.length).toBe(163);
    expect(tech.every((r) => r.key.startsWith("shared-write-"))).toBe(true);
    const ids = new Set(catalog.cards.map((c) => c.id));
    for (const r of tech) expect(ids.has(`rule.summary:${r.key}`)).toBe(false);
    // forms stay as backend entities so rules/processes can roll up by form
    expect(catalog.entities.filter((e) => e.type === "form" || e.type === "usercontrol")).toHaveLength(78);
  });

  it("matches the current snapshot sizes", () => {
    expect(kb.rules.length).toBe(840);
    expect(kb.concepts.length).toBe(62);
    expect(kb.forms.length).toBe(78);
    expect(kb.processes.length).toBe(10);
  });

  it("produces no warnings and unique ids", () => {
    expect(catalog.warnings).toEqual([]);
    expect(new Set(catalog.cards.map((c) => c.id)).size).toBe(catalog.cards.length);
  });

  it("every card points to an existing YAML entity and every link resolves", () => {
    const keys = new Set(catalog.entities.map(entityKey));
    for (const c of catalog.cards) {
      expect(keys.has(entityKey(c.entity)), c.id).toBe(true);
      expect(c.sourceField.length).toBeGreaterThan(0);
      expect(c.back.trim().length).toBeGreaterThan(0);
      for (const l of c.links) expect(keys.has(entityKey(l)), `${c.id} -> ${entityKey(l)}`).toBe(true);
    }
  });

  it("links rule cards to their forms and processes", () => {
    const r = kb.rules[0];
    const card = catalog.cards.find((c) => c.id === `rule.summary:${r.key}`)!;
    const forms = (r.applies_to ?? []).filter((a) => a.startsWith("form:")).map((a) => a.slice(5));
    for (const f of forms) expect(card.links.some((l) => l.key === f && l.relation === "applies_to_form")).toBe(true);
    for (const p of r.processes ?? []) expect(card.links.some((l) => l.type === "process" && l.key === p)).toBe(true);
  });

  it("is deterministic (same YAML -> same hashes)", () => {
    const again = buildCatalog(loadKnowledgeBase("kb"));
    expect(again.cards.map((c) => c.sourceHash)).toEqual(catalog.cards.map((c) => c.sourceHash));
    expect(again.entities.map((e) => e.contentHash)).toEqual(catalog.entities.map((e) => e.contentHash));
  });

  it("reports data-quality findings in the YAML", () => {
    const truncated = catalog.quality.filter((q) => q.issue === "truncated");
    expect(truncated.some((q) => q.entity.key === "material-issue-lot-selection-rules")).toBe(true);
    for (const q of catalog.quality) expect(q.yamlFile).toMatch(/\.yaml$/);
  });

  it("cleans doc cross-references and parses messages", () => {
    expect(displayText("Can''t select lot")).toBe("Can't select lot");
    expect(displayText("Mandatory, 25 characters (BR-01).")).toBe("Mandatory, 25 characters.");
    expect(displayText("Locked (see Section 13 for gaps).")).toBe("Locked.");
    expect(ruleMessages('Evidence: code\nMessages: "Enter A.", "Can\'t do B."\nSource: x')).toEqual(["Enter A.", "Can't do B."]);
  });
});
