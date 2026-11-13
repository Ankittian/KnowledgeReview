import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { DeckClient } from "@/components/deck/DeckClient";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { requireUser } from "@/lib/auth/session";
import { pickAudiences } from "@/lib/cards/audience";
import { APP_TZ, todayStr } from "@/lib/dates";
import { getOrCreateDeck } from "@/lib/deck";
import { getStreak } from "@/lib/stats";
import { getAnswerRole } from "@/lib/chat/service";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const { user, sessionId } = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const today = todayStr();
  // your own set (functional / technical); admins can look at either set
  const audiences = pickAudiences(user.role, sp.audience);
  const deck = await getOrCreateDeck(db, user, today, sessionId, audiences);
  const [{ streak, answeredToday }, myRole] = await Promise.all([
    getStreak(db, user.id, today),
    getAnswerRole(db, user.id),
  ]);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: APP_TZ }).format(new Date());
  return (
    <>
      {user.role === "admin" && (
        <div className="mx-auto flex w-full max-w-xl items-center gap-2 px-4 pt-4 text-sm">
          <span className="text-muted-foreground">Viewing as</span>
          {(["functional", "technical"] as const).map((a) => (
            <Link key={a} href={`/today?audience=${a}`} className={buttonVariants({ size: "sm", variant: audiences.length === 1 && audiences[0] === a ? "default" : "outline" }) + " capitalize"}>
              {a}
            </Link>
          ))}
          <Link href="/today" className={buttonVariants({ size: "sm", variant: audiences.length === 2 ? "default" : "outline" })}>
            Both
          </Link>
        </div>
      )}
      <DeckClient
        key={`${deck.date}:${deck.deckId ?? "none"}:${audiences.join("+")}`}
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
      <ChatWidget myRole={myRole} />
    </>
  );
}
