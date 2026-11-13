import type { Level } from "@/lib/cards/spec";

const TONE: Record<Level, string> = {
  easy: "bg-success-soft text-success",
  medium: "bg-warning-soft text-warning",
  hard: "bg-danger-soft text-danger",
};

/** "Easy · 1" / "Medium · 3" / "Hard · 5": the level and what an answer to the card is worth. */
export function LevelChip({ level, weight }: { level: Level; weight: number }) {
  return (
    <span className={`chip font-semibold capitalize ${TONE[level]}`} title={`${level} card: worth ${weight} when answered`} data-testid="level-chip">
      {level} · {weight}
    </span>
  );
}
