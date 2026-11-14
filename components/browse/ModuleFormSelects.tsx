"use client";

import { useState } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export type FormOption = { id: number; name: string; n: number; module: string | null };

/**
 * The Area (module) and Form dropdowns of the Browse search. Picking an area immediately narrows the Form list
 * to that area's forms, and clears a picked form that belongs to another area. Both are plain named selects,
 * so the surrounding GET form still submits `module` and `form` as before.
 */
export function ModuleFormSelects({
  modules,
  forms,
  initialModule,
  initialForm,
}: {
  modules: { code: string; name: string }[];
  forms: FormOption[];
  initialModule: string;
  initialForm: string;
}) {
  const [module, setModule] = useState(initialModule);
  const [form, setForm] = useState(initialForm);
  const visible = module ? forms.filter((f) => f.module === module) : forms;
  // never submit a form that is not in the list (e.g. a stale link, or the area was changed)
  const formValue = visible.some((f) => String(f.id) === form) ? form : "";

  return (
    <>
      <NativeSelect
        name="module"
        value={module}
        onChange={(e) => {
          setModule(e.target.value);
          setForm("");
        }}
        className="w-full sm:w-56 [&_select]:h-9"
        aria-label="Area"
      >
        <NativeSelectOption value="">All areas</NativeSelectOption>
        {modules.map((m) => (
          <NativeSelectOption key={m.code} value={m.code}>
            {m.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect name="form" value={formValue} onChange={(e) => setForm(e.target.value)} className="w-full sm:w-56 [&_select]:h-9" aria-label="Form">
        <NativeSelectOption value="">{module ? "All forms in this area" : "All forms"}</NativeSelectOption>
        {visible.map((f) => (
          <NativeSelectOption key={f.id} value={String(f.id)}>
            {f.name} ({f.n})
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}
