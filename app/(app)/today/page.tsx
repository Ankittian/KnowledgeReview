import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { DeckClient } from "@/components/deck/DeckClient";
import { requireUser } from "@/lib/auth/session";
import { APP_TZ, todayStr } from "@/lib/dates";
import { getOrCreateDeck } from "@/lib/deck";
import { getStreak } from "@/lib/stats";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const { user, sessionId } = await requireUser();
  const db = await getDb();
  const today = todayStr();
  // a fresh random set per sign-in, capped by the admin's daily card limit
  const deck = await getOrCreateDeck(db, user, today, sessionId);
  const { streak, answeredToday } = await getStreak(db, user.id, today);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: APP_TZ }).format(new Date());
  return (
    <DeckClient
      key={`${deck.date}:${deck.deckId ?? "none"}`}
      deckId={deck.deckId}
      date={deck.date}
      dateLabel={dateLabel}
      cards={deck.cards}
      answered={deck.answered}
      answeredTodayTotal={deck.answeredToday}
      dailyLimit={deck.dailyLimit}
      streak={streak}
      answeredToday={answeredToday}
    />
  );
}
