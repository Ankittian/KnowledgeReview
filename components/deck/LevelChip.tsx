import type { Level } from "@/lib/cards/spec";

const TONE: Record<Level, string> = {
  easy: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  hard: "bg-destructive/10 text-destructive",
};

/** "Easy · 1" / "Medium · 2" / "Hard · 3": the level and the points a correct answer is worth. */
export function LevelChip({ level, weight }: { level: Level; weight: number }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${TONE[level]}`} title={`${level} card: worth ${weight} when answered`} data-testid="level-chip">
      {level} · {weight}
    </span>
  );
}
