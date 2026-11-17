"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createGenerationJob } from "@/app/actions/card-generation";
import { surface } from "@/components/admin/bits";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AUDIENCES, AUDIENCE_LABEL, DEFAULT_AUDIENCE, DEFAULT_COUNTS, DEFAULT_GEN_MODEL, estimateJob, GEN_MODELS, itemTotal, LIMITS, type Audience, type GenModel, type JobItem } from "@/lib/cards/generate/config";
import type { GenerationOptions } from "@/lib/cards/generate/options";
import { cn } from "@/lib/utils";
import { MultiSelect, type MultiOption } from "./MultiSelect";

type Level = "module" | "form";
type Counts = { easy: number; medium: number; hard: number };

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const set = (n: number) => onChange(Math.max(0, Math.min(LIMITS.maxPerLevel, n)));
  return (
    <div className="inline-flex items-center rounded-lg border bg-background" role="group" aria-label={label}>
      <button type="button" className="px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => set(value - 1)} disabled={value <= 0} aria-label={`Fewer ${label}`}>
        <Minus className="size-3.5" />
      </button>
      <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className="px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => set(value + 1)} disabled={value >= LIMITS.maxPerLevel} aria-label={`More ${label}`}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function NewGenerationForm({ options, maxCards }: { options: GenerationOptions; maxCards: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [audience, setAudience] = useState<Audience>(options.audiences.includes(DEFAULT_AUDIENCE) ? DEFAULT_AUDIENCE : (options.audiences[0] ?? DEFAULT_AUDIENCE));
  const [level, setLevel] = useState<Level>("form");
  const [selected, setSelected] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [defaults, setDefaults] = useState<Counts>({ ...DEFAULT_COUNTS });
  const [model, setModel] = useState<GenModel>(DEFAULT_GEN_MODEL);
  const [instructions, setInstructions] = useState("");

  const formOptions: MultiOption[] = useMemo(
    () =>
      options.forms
        .map((f) => ({ value: f.key, label: f.name, hint: `${f.cards[audience]} card${f.cards[audience] === 1 ? "" : "s"}`, group: f.module, groupLabel: `${options.modules.find((m) => m.key === f.module)?.name ?? f.module} (${f.module})` }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)),
    [options, audience],
  );
  const moduleOptions: MultiOption[] = useMemo(() => options.modules.map((m) => ({ value: m.key, label: `${m.name} (${m.key})`, hint: `${m.forms} forms` })), [options]);

  const switchLevel = (l: Level) => {
    if (l === level) return;
    setLevel(l);
    setSelected([]);
  };

  // the items the admin picked, with their counts (default until changed)
  const items: JobItem[] = useMemo(() => {
    return selected.flatMap((key): JobItem[] => {
      const c = counts[key] ?? defaults;
      if (level === "form") {
        const f = options.forms.find((x) => x.key === key);
        return f ? [{ key, scope: "form", module: f.module, title: f.name, ...c }] : [];
      }
      const m = options.modules.find((x) => x.key === key);
      return m ? [{ key, scope: "module", module: m.key, title: m.name, ...c }] : [];
    });
  }, [selected, counts, defaults, level, options]);

  const setCount = (key: string, k: keyof Counts, n: number) => setCounts((c) => ({ ...c, [key]: { ...(c[key] ?? defaults), [k]: n } }));
  const applyAll = () => setCounts(Object.fromEntries(selected.map((k) => [k, { ...defaults }])));

  const est = estimateJob(items, model);
  const over = est.cards > maxCards;
  const empty = items.some((i) => itemTotal(i) < 1);
  const existing = items.reduce((n, i) => n + (level === "form" ? (options.forms.find((f) => f.key === i.key)?.cards[audience] ?? 0) : (options.modules.find((m) => m.key === i.key)?.commonCards[audience] ?? 0)), 0);

  const quickPicks =
    level === "form"
      ? [
          { label: "No cards yet", values: options.forms.filter((f) => f.cards[audience] === 0).map((f) => f.key) },
          { label: "Fewer than 6 cards", values: options.forms.filter((f) => f.cards[audience] < 6).map((f) => f.key) },
        ].filter((p) => p.values.length > 0)
      : [{ label: "All modules", values: options.modules.map((m) => m.key) }];

  const submit = () =>
    start(async () => {
      const res = await createGenerationJob({ audience, level, model, instructions: instructions.trim(), items });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Generation started. You will be notified when it is ready.");
      router.push("/admin/cards");
    });

  const noun = level === "form" ? "form" : "module";
  const [showNotes, setShowNotes] = useState(false);
  const setAll = (k: keyof Counts, n: number) => {
    setDefaults((d) => ({ ...d, [k]: n }));
    setCounts(Object.fromEntries(selected.map((key) => [key, { ...(counts[key] ?? defaults), [k]: n }])));
  };

  const seg = (active: boolean) =>
    cn("rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", active ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]" : "text-muted-foreground hover:text-foreground");

  return (
    <div className={cn(surface, "space-y-5 p-5")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Audience">
          {AUDIENCES.map((a) => {
            const ready = options.audiences.includes(a);
            return (
              <button key={a} type="button" role="tab" aria-selected={audience === a} disabled={!ready} title={ready ? undefined : `No ${a} prompt template yet`} data-testid={`audience-${a}`} onClick={() => setAudience(a)} className={seg(audience === a)}>
                {AUDIENCE_LABEL[a]}
              </button>
            );
          })}
        </div>
        <div className="inline-flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Level">
          {(["form", "module"] as const).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={level === l} data-testid={`level-${l}`} onClick={() => switchLevel(l)} className={seg(level === l)}>
              {l === "form" ? "Form level" : "Module level"}
            </button>
          ))}
        </div>
        <NativeSelect id="model" aria-label="Model" size="sm" value={model} onChange={(e) => setModel(e.target.value as GenModel)} data-testid="model" className="ml-auto">
          {(Object.keys(GEN_MODELS) as GenModel[]).map((m) => (
            <option key={m} value={m}>
              {GEN_MODELS[m].label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <MultiSelect
        options={level === "form" ? formOptions : moduleOptions}
        value={selected}
        onChange={setSelected}
        placeholder={level === "form" ? "Select one or more forms…" : "Select one or more modules…"}
        searchPlaceholder={level === "form" ? "Search forms…" : "Search modules…"}
        quickPicks={quickPicks}
      />

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{level === "form" ? "Form" : "Module"}</th>
                <th className="px-3 py-2 text-left font-medium" title="Cards that already exist">
                  Have
                </th>
                <th className="px-3 py-2 text-left font-medium">Easy</th>
                <th className="px-3 py-2 text-left font-medium">Medium</th>
                <th className="px-3 py-2 text-left font-medium">Hard</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length > 1 && (
                <tr className="border-t bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground" colSpan={2}>
                    Set all
                  </td>
                  {(["easy", "medium", "hard"] as const).map((k) => (
                    <td key={k} className="px-3 py-2">
                      <Stepper value={defaults[k]} onChange={(n) => setAll(k, n)} label={`${k} cards for all`} />
                    </td>
                  ))}
                  <td />
                </tr>
              )}
              {items.map((i) => {
                const have = level === "form" ? options.forms.find((f) => f.key === i.key)?.cards[audience] : options.modules.find((m) => m.key === i.key)?.commonCards[audience];
                return (
                  <tr key={i.key} className="border-t">
                    <td className="px-3 py-2 font-medium">{i.title}</td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{have ?? 0}</td>
                    {(["easy", "medium", "hard"] as const).map((k) => (
                      <td key={k} className="px-3 py-2">
                        <Stepper value={i[k]} onChange={(n) => setCount(i.key, k, n)} label={`${k} cards for ${i.title}`} />
                      </td>
                    ))}
                    <td className={cn("px-3 py-2 text-right font-medium tabular-nums", itemTotal(i) < 1 && "text-destructive")}>{itemTotal(i)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNotes ? (
        <Textarea aria-label="Additional instructions" autoFocus value={instructions} maxLength={LIMITS.instructionsMax} onChange={(e) => setInstructions(e.target.value)} placeholder="Instructions for this run, e.g. focus on approvals" className="min-h-16" />
      ) : (
        <button type="button" onClick={() => setShowNotes(true)} className="text-sm text-muted-foreground hover:text-foreground">
          + Add instructions
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <p className="min-w-0 flex-1 text-sm" data-testid="summary">
          <span className="font-semibold">
            {items.length} {noun}
            {items.length === 1 ? "" : "s"} · {est.cards} cards
          </span>
          {items.length > 0 && !over && !empty && (
            <span className="text-muted-foreground">
              {" "}
              · ~${est.usd.toFixed(2)} · ~{est.minutes} min
            </span>
          )}
          {over && <span className="text-destructive"> · over the limit of {maxCards}</span>}
          {empty && !over && <span className="text-destructive"> · every item needs a card</span>}
        </p>
        <Button type="button" onClick={submit} disabled={pending || items.length === 0 || over || empty} data-testid="generate">
          {pending ? <Spinner /> : <Sparkles />} Generate
        </Button>
      </div>
    </div>
  );
}
