import { addDays } from "./dates";

/** Leitner boxes 1..5 -> days until the card is due again. */
export const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30] as const;

export interface SrsPrev {
  box: number;
  reps: number;
  lapses: number;
}

export function nextSrs(prev: SrsPrev | null, knewIt: boolean, today: string) {
  if (knewIt) {
    const box = prev ? Math.min(5, prev.box + 1) : 2;
    return { box, dueDate: addDays(today, BOX_INTERVAL_DAYS[box]), reps: (prev?.reps ?? 0) + 1, lapses: prev?.lapses ?? 0 };
  }
  return { box: 1, dueDate: addDays(today, BOX_INTERVAL_DAYS[1]), reps: (prev?.reps ?? 0) + 1, lapses: (prev?.lapses ?? 0) + 1 };
}
