import type { Metadata } from "next";
import { ChatApp } from "@/components/chat/ChatApp";
import { FlashcardWidget, FlashcardBanner } from "@/components/deck/FlashcardWidget";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { todayStr } from "@/lib/dates";
import { getOrCreateDeck } from "@/lib/deck";
import { getStreak } from "@/lib/stats";
import { loadChatPage } from "./data";

export const metadata: Metadata = { title: "Assistant" };

export default async function ChatPage() {
  const session = await requireUser();
  const { found: _f, ...data } = await loadChatPage(session, null);
  const db = await getDb();
  const today = todayStr();
  const [deck, { streak, answeredToday }] = await Promise.all([
    getOrCreateDeck(db, session.user, today, session.sessionId),
    getStreak(db, session.user.id, today),
  ]);
  const remaining = deck.cards.filter((c) => !deck.answered.includes(c.v)).length;
  const nextCard = deck.cards.find((c) => !deck.answered.includes(c.v));

  return (
    <div className="flex gap-4 pr-4">
      <div className="min-w-0 flex-1">
        <FlashcardBanner remaining={remaining} total={deck.cards.length} streak={streak} />
        <ChatApp key="new" {...data} />
      </div>
      <FlashcardWidget
        remaining={remaining}
        total={deck.cards.length}
        streak={streak}
        answeredToday={answeredToday}
        nextCardFront={nextCard?.front ?? null}
      />
    </div>
  );
}
