"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  BookOpenText,
  Database,
  GitBranch,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { CHAT_ERROR_TEXT, type ChatErrorCode } from "@/lib/chat/errors";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LogoMark } from "@/components/shell/Logo";
import { CopyButton, Markdown } from "./Markdown";

export type AnswerRole = "technical" | "functional" | "product";

export interface ConvItem {
  id: string;
  title: string;
  roleUsed: AnswerRole;
  updatedAt: string;
}

export interface Msg {
  id: number;
  sender: "user" | "assistant";
  content: string;
  status: "ok" | "streaming" | "stopped" | "error";
  errorCode: string | null;
  feedback: { value: "up" | "down"; comment: string | null } | null;
}

interface Props {
  conversations: ConvItem[];
  active: { id: string; title: string; roleUsed: AnswerRole } | null;
  messages: Msg[];
  isAdmin: boolean;
  myRole: AnswerRole;
}

interface Live {
  messageId: number;
  phase: "connecting" | "queued" | "running";
  position: number;
  activity: string | null;
}

const ROLES: { value: AnswerRole; label: string; hint: string }[] = [
  { value: "technical", label: "Technical", hint: "Code, tables, stored procedures" },
  { value: "functional", label: "Functional", hint: "Screens, steps, business rules" },
  { value: "product", label: "Product", hint: "Scope, capabilities, gaps" },
];
const roleLabel = (r: AnswerRole) => ROLES.find((x) => x.value === r)?.label ?? r;

const errorText = (code: string | null) => CHAT_ERROR_TEXT[(code as ChatErrorCode) ?? "error"] ?? CHAT_ERROR_TEXT.error;

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
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function ChatApp({ conversations: initialConvs, active: initialActive, messages: initialMessages, isAdmin, myRole }: Props) {
  const [convs, setConvs] = useState(initialConvs);
  const [active, setActive] = useState(initialActive);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [newRole, setNewRole] = useState<AnswerRole>(myRole);
  const [live, setLive] = useState<Live | null>(null);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const patchMsg = useCallback((id: number, fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m))), []);

  // ---- streaming (SSE)
  const attach = useCallback(
    (messageId: number) => {
      esRef.current?.close();
      setLive({ messageId, phase: "connecting", position: 0, activity: null });
      const es = new EventSource(`/api/chat/messages/${messageId}/stream`);
      esRef.current = es;
      const data = (e: MessageEvent) => JSON.parse(e.data);
      es.addEventListener("snapshot", (e) => {
        const d = data(e as MessageEvent);
        patchMsg(messageId, (m) => ({ ...m, content: d.text }));
        setLive((l) => l && { ...l, phase: d.phase === "queued" ? "queued" : "running", position: d.position, activity: d.activity });
      });
      es.addEventListener("queued", (e) => setLive((l) => l && { ...l, phase: "queued", position: data(e as MessageEvent).position }));
      es.addEventListener("started", () => setLive((l) => l && { ...l, phase: "running", position: 0 }));
      es.addEventListener("activity", (e) => setLive((l) => l && { ...l, activity: data(e as MessageEvent).label }));
      es.addEventListener("delta", (e) => {
        const t = data(e as MessageEvent).text as string;
        patchMsg(messageId, (m) => ({ ...m, content: m.content + t }));
      });
      es.addEventListener("done", (e) => {
        const d = data(e as MessageEvent);
        patchMsg(messageId, (m) => ({ ...m, content: d.text, status: d.status, errorCode: d.errorCode }));
        setLive(null);
        es.close();
        esRef.current = null;
        setTimeout(() => inputRef.current?.focus(), 0);
      });
      es.onerror = () => {
        // EventSource reconnects by itself; the server replays a snapshot. Give up only if the server refused us.
        if (es.readyState === EventSource.CLOSED) {
          setLive(null);
          esRef.current = null;
        }
      };
    },
    [patchMsg],
  );

  useEffect(() => {
    const last = initialMessages.at(-1);
    if (last?.sender === "assistant" && last.status === "streaming") attach(last.id);
    return () => esRef.current?.close();
  }, [attach, initialMessages]);

  // ---- auto-scroll while the answer streams, unless the user scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ---- actions
  async function send() {
    const text = input.trim();
    if (!text || sending || live) return;
    setSending(true);
    setBanner(null);
    try {
      const r = await api<{
        conversation: { id: string; title: string; roleUsed: AnswerRole };
        userMessage: { id: number };
        assistantMessageId: number;
      }>("/api/chat/send", { method: "POST", json: { conversationId: active?.id ?? null, role: active ? null : newRole, text } });
      setInput("");
      stickToBottom.current = true;
      setMessages((ms) => [
        ...ms,
        { id: r.userMessage.id, sender: "user", content: text, status: "ok", errorCode: null, feedback: null },
        { id: r.assistantMessageId, sender: "assistant", content: "", status: "streaming", errorCode: null, feedback: null },
      ]);
      if (!active) {
        setActive(r.conversation);
        window.history.replaceState(null, "", `/chat/${r.conversation.id}`);
      }
      setConvs((cs) => [{ ...r.conversation, updatedAt: new Date().toISOString() }, ...cs.filter((c) => c.id !== r.conversation.id)]);
      attach(r.assistantMessageId);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!live) return;
    try {
      await api(`/api/chat/messages/${live.messageId}/stop`, { method: "POST", json: {} });
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e));
    }
  }

  async function retry(messageId: number) {
    setBanner(null);
    try {
      const r = await api<{ assistantMessageId: number }>(`/api/chat/messages/${messageId}/retry`, { method: "POST", json: {} });
      setMessages((ms) => [...ms, { id: r.assistantMessageId, sender: "assistant", content: "", status: "streaming", errorCode: null, feedback: null }]);
      stickToBottom.current = true;
      attach(r.assistantMessageId);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e));
    }
  }

  async function rate(messageId: number, value: "up" | "down", comment: string | null) {
    const prev = messages.find((m) => m.id === messageId)?.feedback ?? null;
    patchMsg(messageId, (m) => ({ ...m, feedback: { value, comment } }));
    try {
      await api(`/api/chat/messages/${messageId}/feedback`, { method: "POST", json: { value, comment } });
    } catch (e) {
      patchMsg(messageId, (m) => ({ ...m, feedback: prev }));
      setBanner(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveRename() {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return setRenaming(null);
    try {
      await api(`/api/chat/conversations/${renaming.id}`, { method: "PATCH", json: { title } });
      setConvs((cs) => cs.map((c) => (c.id === renaming.id ? { ...c, title } : c)));
      if (active?.id === renaming.id) setActive({ ...active, title });
      setRenaming(null);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/chat/conversations/${id}`, { method: "DELETE" });
      setConvs((cs) => cs.filter((c) => c.id !== id));
      if (active?.id === id) window.location.href = "/chat";
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? convs.filter((c) => c.title.toLowerCase().includes(q)) : convs;
  }, [convs, search]);

  const busy = !!live || sending;
  const lastAssistantId = [...messages].reverse().find((m) => m.sender === "assistant")?.id;

  // ---- render
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3">
        <Link href="/chat" className={cn(buttonVariants(), "h-9 flex-1")} onClick={() => setDrawer(false)} data-testid="new-chat">
          <MessageSquarePlus /> New chat
        </Link>
      </div>
      <div className="px-3 pb-2">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search chats by title" />
        </InputGroup>
      </div>
      <p className="px-4 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">Recent</p>
      <ul className="flex-1 space-y-px overflow-y-auto px-2 pb-3" data-testid="conversation-list">
        {filtered.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">{convs.length ? "No chats match." : "No chats yet."}</li>}
        <AnimatePresence initial={false}>
          {filtered.map((c) => {
            const on = active?.id === c.id;
            return (
              <motion.li
                key={c.id}
                layout="position"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="group/conv relative"
              >
                {renaming?.id === c.id ? (
                  <form
                    className="flex gap-1 p-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveRename();
                    }}
                  >
                    <Input
                      autoFocus
                      className="h-8"
                      value={renaming.title}
                      maxLength={120}
                      onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      aria-label="Chat title"
                    />
                    <Button type="submit" size="sm" variant="outline" className="h-8">
                      Save
                    </Button>
                  </form>
                ) : (
                  <>
                    <Link
                      href={`/chat/${c.id}`}
                      onClick={() => setDrawer(false)}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "relative block rounded-md py-2 pr-9 pl-3 text-sm transition-colors",
                        on ? "bg-accent font-medium text-accent-foreground" : "text-foreground/80 hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      {on && <motion.span layoutId="conv-active" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                      <span className="block truncate">{c.title}</span>
                      {isAdmin && <span className="text-[11px] text-muted-foreground">{roleLabel(c.roleUsed)}</span>}
                    </Link>
                    <div className="absolute top-1/2 right-1 -translate-y-1/2 opacity-100 transition-opacity md:opacity-0 md:group-hover/conv:opacity-100 md:focus-within:opacity-100 md:has-[[aria-expanded=true]]:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${c.title}`} />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onClick={() => setRenaming({ id: c.id, title: c.title })} aria-label={`Rename ${c.title}`}>
                            <Pencil /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete({ id: c.id, title: c.title })} aria-label={`Delete ${c.title}`}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem-6rem)] bg-background md:-mb-10 md:h-[calc(100dvh-3.5rem)]">
      {/* chat list: collapsible panel on desktop, sheet on phones */}
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden transition-[width,border-color] duration-200 ease-out md:block",
          listOpen ? "w-72 border-r" : "w-0 border-r-0",
        )}
        aria-hidden={!listOpen}
        inert={!listOpen}
      >
        <div className="h-full w-72">{sidebar}</div>
      </aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-[85%] max-w-xs gap-0 p-0 md:hidden">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>Chats</SheetTitle>
            <SheetDescription className="sr-only">Your conversations with the assistant</SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawer(true)} aria-label="Open chat list">
            <Menu />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex"
                  onClick={() => setListOpen((o) => !o)}
                  aria-label={listOpen ? "Hide chat list" : "Show chat list"}
                  aria-expanded={listOpen}
                />
              }
            >
              {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </TooltipTrigger>
            <TooltipContent>{listOpen ? "Hide chats" : "Show chats"}</TooltipContent>
          </Tooltip>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="chat-title">
            {active?.title ?? "New chat"}
          </h1>
          {active ? (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="secondary" className="font-normal" data-testid="chat-role" />}>{roleLabel(active.roleUsed)}</TooltipTrigger>
              <TooltipContent>Answer style for this chat</TooltipContent>
            </Tooltip>
          ) : isAdmin ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-xs text-muted-foreground sm:inline">Answer style</span>
              <Select items={ROLES.map((r) => ({ value: r.value, label: r.label }))} value={newRole} onValueChange={(v) => v && setNewRole(v as AnswerRole)}>
                <SelectTrigger size="sm" data-testid="role-select" aria-label="Answer style for this chat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className="flex flex-col">
                        <span>{r.label}</span>
                        <span className="text-xs text-muted-foreground">{r.hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Badge variant="secondary" className="font-normal">
              {roleLabel(myRole)}
            </Badge>
          )}
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-6 md:px-6" data-testid="messages">
          {messages.length === 0 ? (
            <motion.div
              className="mx-auto mt-6 max-w-xl text-center sm:mt-12"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <LogoMark className="mx-auto size-10" />
              <p className="mt-4 text-xl font-semibold tracking-tight">Ask about SpectrumERP</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                Answers come from the knowledge base{isAdmin ? "" : `, written in the ${roleLabel(myRole)} style`}.{" "}
                {isAdmin && "Pick the answer style above; it stays fixed for this chat."}
              </p>
              <div className="mt-7 grid gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map(({ q, icon: Icon }, i) => (
                  <motion.button
                    key={q}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 + i * 0.05, duration: 0.3 }}
                    whileHover={{ y: -1 }}
                    className="group flex items-start gap-3 rounded-lg bg-card px-3.5 py-3 text-sm shadow-card ring-1 ring-foreground/[0.08] transition-colors outline-none hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      setInput(q);
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                    <span>{q}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <ol className="mx-auto max-w-3xl space-y-6">
              {messages.map((m) =>
                m.sender === "user" ? (
                  <motion.li
                    key={m.id}
                    className="flex justify-end"
                    data-testid="user-message"
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  >
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] whitespace-pre-wrap text-secondary-foreground ring-1 ring-foreground/[0.05]">
                      {m.content}
                    </div>
                  </motion.li>
                ) : (
                  <AssistantMessage
                    key={m.id}
                    m={m}
                    live={live?.messageId === m.id ? live : null}
                    canRetry={m.id === lastAssistantId && !busy}
                    onRetry={() => void retry(m.id)}
                    onRate={(v, c) => void rate(m.id, v, c)}
                  />
                ),
              )}
            </ol>
          )}
        </div>

        <div className="shrink-0 px-3 pt-2 pb-3 md:px-4 md:pb-4">
          <AnimatePresence>
            {banner && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="chat-banner"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span className="flex-1">{banner}</span>
                <button type="button" className="rounded p-0.5 hover:bg-destructive/10" onClick={() => setBanner(null)} aria-label="Dismiss">
                  <X className="size-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <form
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-input bg-background p-1.5 pl-3.5 shadow-card transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 dark:bg-input/20"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={inputRef}
              className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-muted-foreground"
              rows={1}
              placeholder="Ask a question about SpectrumERP…"
              value={input}
              maxLength={4000}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              aria-label="Your question"
              data-testid="chat-input"
            />
            <AnimatePresence mode="popLayout" initial={false}>
              {live ? (
                <motion.div key="stop" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                  <Button type="button" variant="outline" className="h-10 rounded-xl px-3" onClick={() => void stop()} aria-label="Stop answer" data-testid="stop">
                    <Square className="fill-current" /> <span className="hidden sm:inline">Stop</span>
                  </Button>
                </motion.div>
              ) : (
                <motion.div key="send" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                  <Button type="submit" size="icon" className="size-10 rounded-xl" disabled={!input.trim() || sending} aria-label="Send" data-testid="send">
                    {sending ? <Spinner /> : <ArrowUp />}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </form>
          <p className="mx-auto mt-2 hidden max-w-3xl items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
            <span className="ml-auto">Answers can be wrong; check important details.</span>
          </p>
        </div>
      </section>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? <span className="font-medium text-foreground">“{confirmDelete.title}”</span> : null} will be removed from your list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) void remove(target.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const SUGGESTIONS = [
  { q: "What is the GRN form used for?", icon: BookOpenText },
  { q: "Which tables does Purchase Order save to?", icon: Database },
  { q: "What happens when a voucher is authorized?", icon: ShieldCheck },
  { q: "Which forms come before and after a Purchase Bill?", icon: GitBranch },
];

function AssistantMessage({
  m,
  live,
  canRetry,
  onRetry,
  onRate,
}: {
  m: Msg;
  live: Live | null;
  canRetry: boolean;
  onRetry: () => void;
  onRate: (v: "up" | "down", comment: string | null) => void;
}) {
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const streaming = m.status === "streaming";

  return (
    <motion.li
      className="group/msg flex gap-3"
      data-testid="assistant-message"
      data-status={m.status}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="mt-0.5 hidden size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:inline-flex" aria-hidden>
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {m.content ? <Markdown text={m.content} /> : null}

        {streaming && (
          <p className="mt-1 flex items-center gap-2 text-sm" data-testid="answer-progress">
            <span className="flex gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-primary"
                  animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
            <span className="text-shimmer">
              {live?.phase === "queued" && live.position > 0
                ? `All assistant slots are busy. You are number ${live.position} in the queue…`
                : (live?.activity ?? (m.content ? "Writing…" : "Thinking…"))}
            </span>
          </p>
        )}

        {m.status === "stopped" && <p className="mt-2 text-xs font-medium text-muted-foreground">Stopped.</p>}

        {m.status === "error" && (
          <div
            className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-sm text-warning"
            role="alert"
            data-testid="answer-error"
          >
            <TriangleAlert className="size-4 shrink-0" />
            <span className="flex-1">{errorText(m.errorCode)}</span>
            {canRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry} data-testid="retry">
                <RotateCcw /> Retry
              </Button>
            )}
          </div>
        )}
        {m.status === "stopped" && canRetry && (
          <Button type="button" variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={onRetry}>
            <RotateCcw /> Regenerate
          </Button>
        )}

        {!streaming && m.content && (
          <div className="mt-2 flex items-center gap-0.5 text-muted-foreground">
            <CopyButton text={m.content} label="Copy answer" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(m.feedback?.value === "up" ? "text-success hover:text-success" : "text-muted-foreground")}
                    onClick={() => {
                      setCommenting(false);
                      onRate("up", null);
                    }}
                    aria-label="Good answer"
                    aria-pressed={m.feedback?.value === "up"}
                    data-testid="thumbs-up"
                  />
                }
              >
                <motion.span key={`up-${m.feedback?.value === "up"}`} initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="inline-flex">
                  <ThumbsUp className={cn(m.feedback?.value === "up" && "fill-current/20")} />
                </motion.span>
              </TooltipTrigger>
              <TooltipContent>Good answer</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(m.feedback?.value === "down" ? "text-destructive hover:text-destructive" : "text-muted-foreground")}
                    onClick={() => {
                      onRate("down", m.feedback?.value === "down" ? m.feedback.comment : null);
                      setComment(m.feedback?.comment ?? "");
                      setCommenting(true);
                    }}
                    aria-label="Bad answer"
                    aria-pressed={m.feedback?.value === "down"}
                    data-testid="thumbs-down"
                  />
                }
              >
                <motion.span key={`down-${m.feedback?.value === "down"}`} initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="inline-flex">
                  <ThumbsDown className={cn(m.feedback?.value === "down" && "fill-current/20")} />
                </motion.span>
              </TooltipTrigger>
              <TooltipContent>Bad answer</TooltipContent>
            </Tooltip>
          </div>
        )}

        <AnimatePresence initial={false}>
          {commenting && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
              onSubmit={(e) => {
                e.preventDefault();
                onRate("down", comment.trim() || null);
                setCommenting(false);
              }}
            >
              <div className="mt-2 flex max-w-xl flex-col gap-2 rounded-lg bg-muted/50 p-2 ring-1 ring-foreground/[0.06] sm:flex-row">
                <Input
                  className="h-8 bg-background"
                  placeholder="What was wrong? (optional)"
                  value={comment}
                  maxLength={2000}
                  onChange={(e) => setComment(e.target.value)}
                  autoFocus
                  data-testid="feedback-comment"
                />
                <div className="flex gap-1.5">
                  <Button type="submit" size="sm" className="h-8">
                    Send
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setCommenting(false)}>
                    Skip
                  </Button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}
