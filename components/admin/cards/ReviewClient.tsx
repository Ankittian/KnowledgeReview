"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, TriangleAlert, Trash2, Undo2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { previewJobPush, pushGenerationJob, saveCardEdit, setGeneratedCardDeleted } from "@/app/actions/card-generation";
import { surface } from "@/components/admin/bits";
import { LevelChip } from "@/components/deck/LevelChip";
import { RichText } from "@/components/deck/RichText";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Audience } from "@/lib/cards/generate/config";
import type { PushPreview } from "@/lib/cards/generate/push";
import { LEVELS, type Level } from "@/lib/cards/spec";
import { cn } from "@/lib/utils";

export interface ReviewCard {
  id: number;
  module: string;
  scope: string;
  groupKey: string;
  groupTitle: string;
  context: string | null;
  level: Level;
  topicKey: string;
  title: string;
  body: string;
  sourceRefs: string[];
  status: string;
  edited: boolean;
  warnings: string[];
}

/** "Material Receipt Note [4:uuid:61031] (form:fGRN)" -> "Material Receipt Note" */
const refName = (r: string) => r.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s*\([a-z]+:[^()\s]+\)\s*$/, "").trim();

export function ReviewClient({ jobId, status, audience, initial }: { jobId: number; status: string; audience: Audience; initial: ReviewCard[] }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [editing, setEditing] = useState<number | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const editable = status === "ready";

  const replace = (c: ReviewCard) => setCards((all) => all.map((x) => (x.id === c.id ? { ...x, ...c } : x)));
  const live = cards.filter((c) => c.status !== "deleted");
  const count = (l: Level) => live.filter((c) => c.level === l).length;
  const warned = live.filter((c) => c.warnings.length).length;
  const edited = live.filter((c) => c.edited).length;

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; scope: string; module: string; cards: ReviewCard[] }>();
    for (const c of cards) {
      const k = `${c.module}:${c.groupKey}`;
      const g = m.get(k) ?? { key: c.groupKey, title: c.groupTitle, scope: c.scope, module: c.module, cards: [] };
      g.cards.push(c);
      m.set(k, g);
    }
    return [...m.values()];
  }, [cards]);

  const downloadJson = () => {
    const byModule = new Map<string, ReviewCard[]>();
    for (const c of live) byModule.set(c.module, [...(byModule.get(c.module) ?? []), c]);
    for (const [module, rows] of byModule) {
      const items = [...new Map(rows.map((r) => [r.groupKey, r])).values()].map((g) => ({
        scope: g.scope,
        key: g.groupKey,
        title: g.groupTitle,
        context: g.context ?? undefined,
        cards: rows.filter((r) => r.groupKey === g.groupKey).map((r) => ({ level: r.level, topic_key: r.topicKey, title: r.title, body: r.body, source_refs: r.sourceRefs })),
      }));
      const blob = new Blob([JSON.stringify({ module, audience, items }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${module}.job${jobId}.${audience}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap gap-2 text-sm" data-testid="review-stats">
        <Stat n={live.length} label="cards" />
        <Stat n={count("easy")} label="easy" tone="success" />
        <Stat n={count("medium")} label="medium" tone="warning" />
        <Stat n={count("hard")} label="hard" tone="destructive" />
        {warned > 0 && <Stat n={warned} label={warned === 1 ? "warning" : "warnings"} tone="warning" />}
        {cards.length - live.length > 0 && <Stat n={cards.length - live.length} label="deleted" />}
      </div>

      {groups.map((g) => (
        <section key={`${g.module}:${g.key}`} className="space-y-2">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold">
            {g.title}
            <span className="text-xs font-normal text-muted-foreground">
              {g.scope}:{g.key} · {g.cards.filter((c) => c.status !== "deleted").length} cards
            </span>
          </h2>
          {g.cards.map((c) =>
            c.status === "deleted" ? (
              <div key={c.id} className={cn(surface, "flex items-center gap-3 border border-dashed px-4 py-3 opacity-60")} data-testid={`card-${c.id}`}>
                <LevelChip level={c.level} weight={LEVELS[c.level].weight} />
                <p className="min-w-0 flex-1 truncate text-sm line-through">{c.title}</p>
                {editable && <UndoButton card={c} onDone={replace} />}
              </div>
            ) : editing === c.id ? (
              <EditCard key={c.id} card={c} onCancel={() => setEditing(null)} onSaved={(n) => (replace(n), setEditing(null))} />
            ) : (
              <article key={c.id} className={cn(surface, "space-y-2 p-4", c.warnings.length > 0 && "ring-warning/40")} data-testid={`card-${c.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <LevelChip level={c.level} weight={LEVELS[c.level].weight} />
                  {c.edited && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">edited</span>}
                  {editable && (
                    <div className="ml-auto flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(c.id)} data-testid={`edit-${c.id}`}>
                        <Pencil /> Edit
                      </Button>
                      <DeleteButton card={c} onDone={replace} />
                    </div>
                  )}
                </div>
                <h3 className="text-[15px] leading-snug font-semibold text-pretty">{c.title}</h3>
                <RichText text={c.body} className="space-y-1.5 text-sm text-muted-foreground" />
                {c.sourceRefs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {c.sourceRefs.map((r, i) => (
                      <span key={i} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" title={r}>
                        {refName(r)}
                      </span>
                    ))}
                  </div>
                )}
                {c.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-warning">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {w}
                  </p>
                ))}
              </article>
            ),
          )}
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur md:left-(--sidebar-width,0)">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" data-testid="push-summary">
              {editable ? `${live.length} cards will be pushed` : `${live.length} cards`}
            </p>
            <p className="text-xs text-muted-foreground">
              {cards.length - live.length} deleted · {edited} edited
            </p>
          </div>
          <Button variant="outline" onClick={downloadJson} disabled={live.length === 0}>
            <Download /> Download JSON
          </Button>
          {editable && (
            <Button onClick={() => setPushOpen(true)} disabled={live.length === 0 || editing !== null} data-testid="push-open">
              <UploadCloud /> Push cards
            </Button>
          )}
        </div>
      </div>

      {pushOpen && <PushDialog jobId={jobId} count={live.length} onClose={() => setPushOpen(false)} onPushed={() => router.refresh()} />}
    </div>
  );
}

const TONE = { neutral: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;
function Stat({ n, label, tone = "neutral" }: { n: number; label: string; tone?: keyof typeof TONE }) {
  return (
    <span className={cn(surface, "rounded-lg px-3 py-1")}>
      <b className={cn("tabular-nums", TONE[tone])}>{n}</b> <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function DeleteButton({ card, onDone }: { card: ReviewCard; onDone: (c: ReviewCard) => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={pending}
      data-testid={`delete-${card.id}`}
      onClick={() =>
        start(async () => {
          const r = await setGeneratedCardDeleted(card.id, true);
          if (r.ok) onDone({ ...card, status: "deleted" });
          else toast.error(r.error);
        })
      }
    >
      <Trash2 /> Delete
    </Button>
  );
}

function UndoButton({ card, onDone }: { card: ReviewCard; onDone: (c: ReviewCard) => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      data-testid={`undo-${card.id}`}
      onClick={() =>
        start(async () => {
          const r = await setGeneratedCardDeleted(card.id, false);
          if (r.ok) onDone({ ...card, status: "draft" });
          else toast.error(r.error);
        })
      }
    >
      <Undo2 /> Undo delete
    </Button>
  );
}

function EditCard({ card, onCancel, onSaved }: { card: ReviewCard; onCancel: () => void; onSaved: (c: ReviewCard) => void }) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [level, setLevel] = useState<Level>(card.level);
  const [topicKey, setTopicKey] = useState(card.topicKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveCardEdit(card.id, { title, body, level, topicKey });
      if (!r.ok) return setError(r.error);
      onSaved({ ...card, title: r.card.title, body: r.card.body, level: r.card.level, topicKey: r.card.topicKey, edited: true, warnings: r.card.warnings });
      toast.success(r.card.warnings.length ? "Saved, with warnings." : "Card saved.");
    });

  return (
    <article className={cn(surface, "space-y-3 p-4 ring-primary/40")} data-testid={`card-${card.id}`}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`t${card.id}`}>Title (the question)</Label>
          <Textarea id={`t${card.id}`} value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-14" data-testid="edit-title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`l${card.id}`}>Level</Label>
          <NativeSelect id={`l${card.id}`} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {(["easy", "medium", "hard"] as const).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`b${card.id}`}>Body (one idea per line; **bold** marks key terms; lines starting with - are bullets)</Label>
        <Textarea id={`b${card.id}`} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-32" data-testid="edit-body" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`k${card.id}`}>Topic key</Label>
        <Input id={`k${card.id}`} value={topicKey} onChange={(e) => setTopicKey(e.target.value)} className="font-mono text-xs" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending} data-testid="edit-save">
          {pending && <Spinner />} Save
        </Button>
      </div>
    </article>
  );
}

type PushFail = { error: string; similar?: { newTitle: string; otherTitle: string; score: number }[] };

function PushDialog({ jobId, count, onClose, onPushed }: { jobId: number; count: number; onClose: () => void; onPushed: () => void }) {
  const [previews, setPreviews] = useState<PushPreview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fail, setFail] = useState<PushFail | null>(null);
  const [pushing, startPush] = useTransition();

  // dry run when the dialog opens
  useEffect(() => {
    let live = true;
    previewJobPush(jobId).then((r) => {
      if (!live) return;
      if (r.ok) setPreviews(r.previews);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [jobId]);

  const sum = (f: (p: PushPreview) => number) => (previews ?? []).reduce((n, p) => n + f(p), 0);
  const unresolved = (previews ?? []).flatMap((p) => p.unresolvedRefs);
  const similar = (previews ?? []).flatMap((p) => p.similar);

  const push = () =>
    startPush(async () => {
      setFail(null);
      const r = await pushGenerationJob(jobId);
      if (r.ok) {
        toast.success("Cards pushed. Learners will see them on their next review.");
        onPushed();
        onClose();
      } else setFail({ error: r.error, similar: r.similar });
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !pushing && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Push {count} cards to the database?</DialogTitle>
          <DialogDescription>Dry run. Nothing is saved yet.</DialogDescription>
        </DialogHeader>

        {!previews && !loadError && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Checking what would change…
          </p>
        )}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {previews && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ["new cards", sum((p) => p.inserted)],
                ["new version", sum((p) => p.newVersion)],
                ["unchanged", sum((p) => p.unchanged)],
                ["links", sum((p) => p.links)],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-lg bg-muted/60 px-2 py-2">
                  <p className="text-lg font-semibold tabular-nums">{n}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {similar.length > 0 && (
              <div className="rounded-lg bg-warning/10 p-3 text-xs text-warning">
                <p className="font-medium">{similar.length} card(s) look like a topic that is already taught. The push will refuse them; edit or delete them first:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {similar.slice(0, 4).map((s, i) => (
                    <li key={i}>{s.newTitle}</li>
                  ))}
                </ul>
              </div>
            )}
            {unresolved.length > 0 && <p className="rounded-lg bg-warning/10 p-3 text-xs text-warning">{unresolved.length} source reference(s) matched no knowledge-base item, so those cards will have no link to them.</p>}
          </div>
        )}
        {fail && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            <p>Push refused: {fail.error}. Nothing was saved.</p>
            {fail.similar?.slice(0, 3).map((s, i) => (
              <p key={i} className="mt-1 text-xs">
                “{s.newTitle}” is close to “{s.otherTitle}”
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pushing}>
            Cancel
          </Button>
          <Button onClick={push} disabled={pushing || !previews || similar.length > 0 || !!fail} data-testid="push-confirm">
            {pushing ? <Spinner /> : <UploadCloud />} Push {count} cards
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
