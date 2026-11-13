import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, ChevronRight, Clock, ShieldAlert, ThumbsDown, ThumbsUp, User, Wrench } from "lucide-react";
import { getDb } from "@/db/client";
import { Markdown } from "@/components/chat/Markdown";
import { Tag, surface } from "@/components/admin/bits";
import { FadeIn, Stagger, StaggerItem } from "@/components/common/motion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { requireRole } from "@/lib/auth/session";
import { chatErrorText } from "@/lib/chat/errors";
import { adminLoadConversation } from "@/lib/chat/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Chat transcript" };

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" }) : "–");

/** Read-only transcript for admins, with tool calls (denied ones included), tokens and timings. */
export default async function AdminChatPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const data = await adminLoadConversation(await getDb(), (await params).id);
  if (!data) notFound();
  const { conversation: c, messages, tools, feedback } = data;

  return (
    <div className="space-y-5">
      <Link href="/admin/chats" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All chats
      </Link>
      <FadeIn>
        <div className={cn(surface, "p-5")}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{c.title}</h2>
            <Tag tone="outline" className="capitalize">
              {c.roleUsed} style
            </Tag>
            {c.deletedAt && <Tag tone="destructive">deleted by user {fmt(c.deletedAt)}</Tag>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {data.displayName} ({data.username}) · started {fmt(c.createdAt)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">Claude session: {c.claudeSessionId ?? "–"}</p>
        </div>
      </FadeIn>

      <Stagger as="ol" className="space-y-4">
        {messages.map((m) => {
          const mt = tools.filter((t) => t.messageId === m.id);
          const fb = feedback.filter((f) => f.messageId === m.id);
          const isUser = m.sender === "user";
          const denied = mt.filter((t) => !t.allowed).length;
          return (
            <StaggerItem as="li" key={m.id} className={cn("flex gap-3", isUser && "flex-row-reverse")}>
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
                  isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground ring-1 ring-foreground/[0.07]",
                )}
                aria-hidden
              >
                {isUser ? <User /> : <Bot />}
              </span>
              <div className={cn("min-w-0", isUser ? "max-w-[85%]" : "flex-1")}>
                <div className={cn("mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", isUser && "justify-end")}>
                  <span className="font-medium text-foreground">{isUser ? "Question" : "Answer"}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" /> {fmt(m.createdAt)}
                  </span>
                  {!isUser && (
                    <>
                      <Tag tone={m.status === "ok" ? "success" : m.status === "error" ? "destructive" : "neutral"}>{m.status}</Tag>
                      {m.durationMs != null && <span className="font-mono tabular-nums">{(m.durationMs / 1000).toFixed(1)} s</span>}
                      {m.tokensIn != null && (
                        <span className="font-mono tabular-nums">
                          {m.tokensIn.toLocaleString()} in / {(m.tokensOut ?? 0).toLocaleString()} out tokens
                        </span>
                      )}
                      {m.numTurns != null && <span className="tabular-nums">{m.numTurns} turns</span>}
                      {m.model && <span className="font-mono">{m.model}</span>}
                    </>
                  )}
                </div>

                {isUser ? (
                  <div className="rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-[15px] whitespace-pre-wrap text-primary-foreground">{m.content}</div>
                ) : (
                  <div className={cn(surface, "p-4")}>
                    {m.content ? <Markdown text={m.content} /> : <p className="text-sm text-muted-foreground">(no text)</p>}
                    {m.status === "error" && <p className="mt-3 rounded-lg bg-warning/12 px-3 py-2 text-sm text-warning">{chatErrorText(m.errorCode)}</p>}

                    {mt.length > 0 && (
                      <Collapsible className="mt-3 rounded-lg border bg-muted/40">
                        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
                          <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90" />
                          <Wrench className="size-3.5 text-muted-foreground" />
                          {mt.length} tool call{mt.length === 1 ? "" : "s"}
                          {denied > 0 && <Tag tone="destructive">{denied} denied</Tag>}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                          <ul className="space-y-2 border-t px-3 py-2.5">
                            {mt.map((t) => (
                              <li key={t.id} className="font-mono text-xs">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {t.allowed ? null : <ShieldAlert className="size-3.5 text-destructive" />}
                                  <span className={cn("font-semibold", !t.allowed && "text-destructive")}>{t.toolName}</span>
                                  {t.durationMs != null && <span className="text-muted-foreground">· {t.durationMs} ms</span>}
                                  {t.isError && <span className="text-warning">· error</span>}
                                </div>
                                <pre className="mt-1 overflow-x-auto rounded-md bg-background px-2 py-1.5 whitespace-pre-wrap text-muted-foreground ring-1 ring-foreground/[0.06]">
                                  {JSON.stringify(t.arguments)}
                                </pre>
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {fb.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t pt-3">
                        {fb.map((f, i) => (
                          <p key={i} className="flex items-center gap-1.5 text-sm">
                            {f.value === "up" ? <ThumbsUp className="size-4 text-success" /> : <ThumbsDown className="size-4 text-destructive" />}
                            <span className="text-muted-foreground">{f.username}</span>
                            {f.comment && <span>“{f.comment}”</span>}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}
