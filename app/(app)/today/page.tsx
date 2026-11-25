import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { DeckClient } from "@/components/deck/DeckClient";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { requireUser } from "@/lib/auth/session";
import { canSwitchSets, pickAudiences } from "@/lib/cards/audience";
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
      <div className="relative mx-auto w-full max-w-xl">
        {canSwitchSets(user.role) && (
          <div className="flex items-center gap-2 px-4 pt-4 text-sm xl:absolute xl:top-4 xl:right-full xl:mr-4 xl:w-36 xl:flex-col xl:items-stretch xl:gap-1.5 xl:px-0 xl:pt-0">
            <span className="text-muted-foreground xl:mb-0.5 xl:text-xs xl:font-medium xl:tracking-wider xl:uppercase">Viewing as</span>
            {(["functional", "technical"] as const).map((a) => (
              <Link key={a} href={`/today?audience=${a}`} className={buttonVariants({ size: "sm", variant: audiences.length === 1 && audiences[0] === a ? "default" : "outline" }) + " capitalize xl:justify-start"}>
                {a}
              </Link>
            ))}
            <Link href="/today" className={buttonVariants({ size: "sm", variant: audiences.length === 2 ? "default" : "outline" }) + " xl:justify-start"}>
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
      </div>
      <ChatWidget myRole={myRole} canUseKgNew={kgNewAllowed} />
    </>
  );
}
