import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { DeckClient } from "@/components/deck/DeckClient";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { requireUser } from "@/lib/auth/session";
import { pickAudiences } from "@/lib/cards/audience";
import { APP_TZ, todayStr } from "@/lib/dates";
import { getOrCreateDeck } from "@/lib/deck";
import { getStreak } from "@/lib/stats";
import { canUseKgNew, getAnswerRole } from "@/lib/chat/service";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const { user, sessionId } = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const today = todayStr();
  // your own set (functional / technical); admin and technical users can look at either set
  const audiences = pickAudiences(user.role, sp.audience);
  const deck = await getOrCreateDeck(db, user, today, sessionId, audiences);
  const [{ streak, answeredToday }, myRole, kgNewAllowed] = await Promise.all([
    getStreak(db, user.id, today),
    getAnswerRole(db, user.id),
    canUseKgNew(db, user.id, user.role === "admin"),
  ]);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: APP_TZ }).format(new Date());
  return (
    <>
      <DeckClient
        key={`${deck.date}:${deck.deckId ?? "none"}:${audiences.join("+")}`}
        deckId={deck.deckId}
        date={deck.date}
        dateLabel={dateLabel}
        cards={deck.cards}
        answered={deck.answered}
        answers={deck.answers}
        answeredTodayTotal={deck.answeredToday}
        dailyLimit={deck.dailyLimit}
        streak={streak}
        answeredToday={answeredToday}
      />
      <ChatWidget myRole={myRole} canUseKgNew={kgNewAllowed} />
    </>
  );
}
