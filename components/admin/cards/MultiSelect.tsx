"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiOption {
  value: string;
  label: string;
  /** small text on the right, e.g. "12 cards" */
  hint?: string;
  /** options with the same group are listed under one header that selects the whole group */
  group?: string;
  groupLabel?: string;
}

export interface QuickPick {
  label: string;
  /** values this pick selects (replaces the current selection) */
  values: string[];
}

/** One dropdown with search, group headers, quick picks and the chosen items shown as removable chips. */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Search...",
  quickPicks = [],
  id,
}: {
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  quickPicks?: QuickPick[];
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const chosen = useMemo(() => new Set(value), [value]);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t) || (o.groupLabel ?? "").toLowerCase().includes(t)) : options;
  }, [options, q]);
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: MultiOption[] }>();
    for (const o of shown) {
      const k = o.group ?? "";
      const g = m.get(k) ?? { label: o.groupLabel ?? "", items: [] };
      g.items.push(o);
      m.set(k, g);
    }
    return [...m.entries()];
  }, [shown]);

  const toggle = (v: string) => onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const toggleGroup = (items: MultiOption[]) => {
    const all = items.every((i) => chosen.has(i.value));
    const ids = new Set(items.map((i) => i.value));
    onChange(all ? value.filter((v) => !ids.has(v)) : [...value, ...items.map((i) => i.value).filter((v) => !chosen.has(v))]);
  };

  return (
    <div ref={root} className="relative">
      <div
        className={cn("flex min-h-10 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 text-sm", open && "border-ring ring-3 ring-ring/30")}
        onClick={() => setOpen((o) => !o)}
      >
        {value.length === 0 && (
          <span id={id} className="px-1 text-muted-foreground">
            {placeholder}
          </span>
        )}
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-primary/10 py-0.5 pr-1 pl-2 text-xs font-medium text-primary">
            {byValue.get(v)?.label ?? v}
            <button
              type="button"
              className="rounded p-0.5 hover:bg-primary/15"
              aria-label={`Remove ${byValue.get(v)?.label ?? v}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(v);
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-float ring-1 ring-foreground/10" role="listbox" aria-multiselectable>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-10 w-full bg-transparent text-sm outline-none" />
          </div>
          {(quickPicks.length > 0 || value.length > 0) && (
            <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
              {quickPicks.map((p) => (
                <button key={p.label} type="button" onClick={() => onChange(p.values)} className="rounded-full border px-2.5 py-0.5 text-xs text-primary hover:bg-primary/10">
                  {p.label}
                </button>
              ))}
              {value.length > 0 && (
                <button type="button" onClick={() => onChange([])} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                  Clear
                </button>
              )}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</p>}
            {groups.map(([key, g]) => {
              const all = g.items.every((i) => chosen.has(i.value));
              const some = g.items.some((i) => chosen.has(i.value));
              return (
                <div key={key}>
                  {key !== "" && (
                    <button type="button" onClick={() => toggleGroup(g.items)} className="flex w-full items-center gap-2 bg-muted/50 px-3 py-1.5 text-left text-xs font-semibold hover:bg-muted">
                      <Box state={all ? "all" : some ? "some" : "none"} />
                      {g.label || key}
                      <span className="ml-auto font-normal text-muted-foreground">{g.items.filter((i) => chosen.has(i.value)).length}/{g.items.length} selected</span>
                    </button>
                  )}
                  {g.items.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={chosen.has(o.value)}
                      onClick={() => toggle(o.value)}
                      className={cn("flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-accent", key !== "" ? "pl-7" : "pl-3")}
                    >
                      <Box state={chosen.has(o.value) ? "all" : "none"} />
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{o.hint}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Box({ state }: { state: "all" | "some" | "none" }) {
  return (
    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", state === "none" ? "border-input bg-background" : "border-primary bg-primary text-primary-foreground")}>
      {state === "all" && <Check className="size-3" />}
      {state === "some" && <span className="h-0.5 w-2 rounded bg-primary-foreground" />}
    </span>
  );
}
