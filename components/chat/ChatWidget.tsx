"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  MessageSquare,
  Minimize2,
  RotateCcw,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { CHAT_ERROR_TEXT, type ChatErrorCode } from "@/lib/chat/errors";
import type { KbSource } from "@/lib/chat/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KgLoader } from "./KgLoader";
import { CopyButton, Markdown } from "./Markdown";
import { ApiError, KB_LABEL, KB_READ_ONLY_TEXT, KbBadge, type KbReadOnly, type KbReadOnlyState } from "./kb";

/* ---- types (minimal subset of ChatApp) ---------------------------------- */
type AnswerRole = "technical" | "functional" | "product";
interface Msg {
  id: number;
  sender: "user" | "assistant";
  content: string;
  status: "ok" | "streaming" | "stopped" | "error";
  errorCode: string | null;
}
interface Live {
  messageId: number;
  phase: "connecting" | "queued" | "running";
  position: number;
  activity: string | null;
}

/* ---- tiny fetch helper -------------------------------------------------- */
async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("Signed out");
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string; reason?: string };
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, d.code, d.reason);
  }
  return data;
}

const errorText = (code: string | null) =>
  CHAT_ERROR_TEXT[(code as ChatErrorCode) ?? "error"] ?? CHAT_ERROR_TEXT.error;

/* ======================================================================== */
export function ChatWidget({ myRole, canUseKgNew = false }: { myRole: AnswerRole; canUseKgNew?: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  // KB of the chat being started: defaults to SpectrumERP, sent with the first message only, fixed afterwards (D1, D18).
  const [kb, setKb] = useState<KbSource>("spectrumerp");
  const [kgNewOk, setKgNewOk] = useState(canUseKgNew);
  const [chatKb, setChatKb] = useState<KbSource>("spectrumerp");
  const [readOnly, setReadOnly] = useState<KbReadOnlyState | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  /* auto-scroll */
  useEffect(() => {
    if (scrollRef.current && stickToBottom.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, live]);

  /* focus input when opened */
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  /* SSE attach */
  const attach = useCallback((messageId: number) => {
    esRef.current?.close();
    setLive({ messageId, phase: "connecting", position: 0, activity: null });
    const es = new EventSource(`/api/chat/messages/${messageId}/stream`);
    esRef.current = es;
    const parse = (e: MessageEvent) => JSON.parse(e.data);
    es.addEventListener("snapshot", (e) => {
      const d = parse(e as MessageEvent);
      setMessages((ms) => ms.map((m) => (m.id === messageId ? { ...m, content: d.text } : m)));
      setLive((l) => l && { ...l, phase: d.phase === "queued" ? "queued" : "running", position: d.position, activity: d.activity });
    });
    es.addEventListener("queued", (e) =>
      setLive((l) => l && { ...l, phase: "queued", position: parse(e as MessageEvent).position }),
    );
    es.addEventListener("started", () => setLive((l) => l && { ...l, phase: "running", position: 0 }));
    es.addEventListener("activity", (e) =>
      setLive((l) => l && { ...l, activity: parse(e as MessageEvent).label }),
    );
    es.addEventListener("delta", (e) => {
      const t = parse(e as MessageEvent).text as string;
      setMessages((ms) => ms.map((m) => (m.id === messageId ? { ...m, content: m.content + t } : m)));
    });
    es.addEventListener("done", (e) => {
      const d = parse(e as MessageEvent);
      setMessages((ms) =>
        ms.map((m) => (m.id === messageId ? { ...m, content: d.text, status: d.status, errorCode: d.errorCode } : m)),
      );
      setLive(null);
      es.close();
      esRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 0);
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setLive(null);
        esRef.current = null;
      }
    };
  }, []);

  useEffect(() => () => esRef.current?.close(), []);

  /* send */
  /** A 403 about the KB is a state: show the server's text and lock the chat (kb_read_only) or the selector (kb_forbidden). */
  function failed(e: unknown) {
    if (e instanceof ApiError && e.code === "kb_read_only") {
      const reason: KbReadOnly = e.reason === "unconfigured" ? "unconfigured" : "revoked";
      setReadOnly({ reason, text: e.message || KB_READ_ONLY_TEXT[reason] });
      setBanner(null);
      return;
    }
    if (e instanceof ApiError && e.code === "kb_forbidden") {
      setKgNewOk(false);
      setKb("spectrumerp");
    }
    setBanner(e instanceof Error ? e.message : String(e));
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || live || readOnly) return;
    setSending(true);
    setBanner(null);
    try {
      const r = await api<{
        conversation: { id: string; title: string; roleUsed: AnswerRole; kbSource?: KbSource };
        userMessage: { id: number };
        assistantMessageId: number;
      }>("/api/chat/send", {
        method: "POST",
        json: { conversationId: convId, role: convId ? null : myRole, text, ...(!convId && kgNewOk ? { kbSource: kb } : {}) },
      });
      setInput("");
      stickToBottom.current = true;
      setMessages((ms) => [
        ...ms,
        { id: r.userMessage.id, sender: "user", content: text, status: "ok", errorCode: null },
        { id: r.assistantMessageId, sender: "assistant", content: "", status: "streaming", errorCode: null },
      ]);
      if (!convId) {
        setConvId(r.conversation.id);
        setChatKb(r.conversation.kbSource ?? (kgNewOk ? kb : "spectrumerp"));
      }
      attach(r.assistantMessageId);
    } catch (e) {
      failed(e);
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!live) return;
    try {
      await api(`/api/chat/messages/${live.messageId}/stop`, { method: "POST", json: {} });
    } catch {/* silent */}
  }

  async function retry(messageId: number) {
    setBanner(null);
    try {
      const r = await api<{ assistantMessageId: number }>(
        `/api/chat/messages/${messageId}/retry`,
        { method: "POST", json: {} },
      );
      setMessages((ms) => [
        ...ms,
        { id: r.assistantMessageId, sender: "assistant", content: "", status: "streaming", errorCode: null },
      ]);
      stickToBottom.current = true;
      attach(r.assistantMessageId);
    } catch (e) {
      failed(e);
    }
  }

  const busy = !!live || sending;
  const lastAssistantId = [...messages].reverse().find((m) => m.sender === "assistant")?.id;

  return (
    <>
      {/* Floating trigger button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => setOpen(true)}
            className="fixed right-5 bottom-28 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/20 transition-shadow hover:shadow-xl hover:ring-primary/30 md:bottom-8"
            aria-label="Open assistant chat"
          >
            <MessageSquare className="size-6" />
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {messages.filter((m) => m.sender === "assistant" && m.status === "ok").length}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="fixed right-4 bottom-24 z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ring-1 ring-foreground/[0.08] md:bottom-6"
            style={{ height: "min(560px, calc(100dvh - 8rem))" }}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-3.5" />
              </span>
              <span className="flex-1 truncate text-sm font-semibold">Ask the Assistant</span>
              {convId && <KbBadge kb={chatKb} />}
              {convId && (
                <a
                  href={`/chat/${convId}`}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Open full chat
                </a>
              )}
              <button
                onClick={() => setOpen(false)}
                className="ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Minimise chat"
              >
                <Minimize2 className="size-4" />
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              onScroll={() => {
                const el = scrollRef.current;
                if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
              className="thin-scroll flex-1 overflow-y-auto px-4 py-3"
            >
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Sparkles className="size-8 opacity-30" />
                  <p className="text-sm">Ask anything about SpectrumERP</p>
                  {kgNewOk && !convId && (
                    <div className="flex flex-col items-center gap-1" data-testid="kb-select">
                      <div role="radiogroup" aria-label="Knowledge base for this chat" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                        {(["spectrumerp", "spectrumerp_new"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={kb === k}
                            onClick={() => setKb(k)}
                            className={cn(
                              "rounded-md px-2.5 py-1 font-medium transition-colors",
                              kb === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {KB_LABEL[k]}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px]">Fixed once you send; use a new chat to switch.</p>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                    {["What is the GRN form?", "How does voucher auth work?"].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); inputRef.current?.focus(); }}
                        className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ol className="space-y-4">
                  {messages.map((m) =>
                    m.sender === "user" ? (
                      <li key={m.id} className="flex justify-end">
                        <div className="group/user flex max-w-[85%] flex-col items-end gap-0.5">
                          <div className="rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm text-secondary-foreground ring-1 ring-foreground/[0.05] whitespace-pre-wrap">
                            {m.content}
                          </div>
                          <CopyButton
                            text={m.content}
                            label="Copy prompt"
                            className="opacity-100 transition-opacity md:opacity-0 md:group-hover/user:opacity-100 md:focus-visible:opacity-100"
                          />
                        </div>
                      </li>
                    ) : (
                      <li key={m.id} className="flex gap-2">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center" aria-hidden>
                          <KgLoader className="size-5" animated={m.status === "streaming"} />
                        </span>
                        <div className="min-w-0 flex-1">
                          {m.content ? <Markdown text={m.content} /> : null}
                          {m.status === "streaming" && live?.messageId === m.id && (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="text-shimmer">
                                {live.phase === "queued" && live.position > 0
                                  ? `Queue position ${live.position}…`
                                  : (live.activity ?? (m.content ? "Writing…" : "Thinking…"))}
                              </span>
                            </p>
                          )}
                          {m.status !== "streaming" && m.content && <CopyButton text={m.content} label="Copy answer" className="-ml-2 mt-1" />}
                          {m.status === "error" && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs text-warning">
                              <TriangleAlert className="size-3.5 shrink-0" />
                              <span className="flex-1">{errorText(m.errorCode)}</span>
                              {m.id === lastAssistantId && !busy && !readOnly && (
                                <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => void retry(m.id)}>
                                  <RotateCcw className="size-3" /> Retry
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ),
                  )}
                </ol>
              )}
            </div>

            {/* Banner */}
            <AnimatePresence>
              {banner && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="shrink-0 overflow-hidden"
                >
                  <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span className="flex-1">{banner}</span>
                    <button onClick={() => setBanner(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-destructive/10">
                      <X className="size-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {readOnly && (
              <div className="flex shrink-0 items-start gap-2 border-t border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs text-warning" role="status" data-testid="chat-read-only">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span className="flex-1">{readOnly.text} This chat is read-only.</span>
              </div>
            )}

            {/* Input */}
            <form
              className="shrink-0 border-t px-3 py-2.5"
              onSubmit={(e) => { e.preventDefault(); void send(); }}
            >
              <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-1.5 pl-3 shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/20">
                <textarea
                  ref={inputRef}
                  rows={1}
                  className="max-h-32 min-h-[32px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={readOnly ? "This chat is read-only" : "Ask a question…"}
                  disabled={!!readOnly}
                  value={input}
                  maxLength={4000}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  aria-label="Your question"
                />
                <AnimatePresence mode="popLayout" initial={false}>
                  {live ? (
                    <motion.div key="stop" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                      <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => void stop()} aria-label="Stop">
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div key="send" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                      <Button type="submit" size="icon" className="size-8 rounded-lg" disabled={!input.trim() || sending || !!readOnly} aria-label="Send">
                        <ArrowUp className="size-3.5" />
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
