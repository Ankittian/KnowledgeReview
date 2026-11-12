import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface KbModule {
  code: string;
  name: string;
  status?: string;
  summary?: string;
  description?: string;
}
export interface KbConcept {
  key: string;
  name: string;
  module?: string;
  synonyms?: string[];
  summary?: string;
  description?: string;
  related_to?: { concept: string; how?: string }[];
  parent_of?: string[];
  tables?: string[];
}
export interface KbRule {
  key: string;
  name: string;
  type: string;
  summary: string;
  description?: string;
  applies_to?: string[];
  implemented_by?: string[];
  processes?: string[];
}
export interface KbProcessStep {
  order: number;
  name: string;
  form: string;
}
export interface KbProcess {
  key: string;
  name: string;
  module?: string;
  status?: string;
  summary?: string;
  description?: string;
  steps: KbProcessStep[];
  concepts?: string[];
  leads_to?: unknown;
  _file: string;
}
export interface KbForm {
  form?: string;
  usercontrol?: string;
  title: string;
  module?: string;
  kind?: string;
  users?: string[];
  summary?: string;
  purpose?: string;
  functional_description?: string;
  actions?: Record<string, string>;
  validations?: string[];
  manages?: string[];
  uses_concepts?: string[];
  method_notes?: Record<string, string>;
  _file: string;
}

export interface KnowledgeBase {
  dir: string;
  modules: KbModule[];
  concepts: KbConcept[];
  rules: KbRule[];
  processes: KbProcess[];
  forms: KbForm[];
}

function readYaml<T>(file: string): T {
  const text = fs.readFileSync(file, "utf8");
  return (YAML.parse(text) ?? {}) as T;
}

function listYaml(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort();
}

/** Loads the knowledge base in the same layout as SpectrumERP's KnowledgeGraph/domain folder. */
export function loadKnowledgeBase(dir: string): KnowledgeBase {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) throw new Error(`KB_DIR not found: ${abs}`);
  const top = <T>(name: string): T[] => {
    const f = path.join(abs, `${name}.yaml`);
    return fs.existsSync(f) ? (readYaml<Record<string, T[]>>(f)[name] ?? []) : [];
  };
  const processes = listYaml(path.join(abs, "processes")).map((f) => ({
    ...readYaml<Omit<KbProcess, "_file">>(path.join(abs, "processes", f)),
    _file: `processes/${f}`,
  }));
  const forms = listYaml(path.join(abs, "forms")).map((f) => ({
    ...readYaml<Omit<KbForm, "_file">>(path.join(abs, "forms", f)),
    _file: `forms/${f}`,
  }));
  return {
    dir: abs,
    modules: top<KbModule>("modules"),
    concepts: top<KbConcept>("concepts"),
    rules: top<KbRule>("rules"),
    processes,
    forms,
  };
}
