import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { chatMessages } from "@/db/schema";
import { json } from "@/lib/request";
import { chatCaller, parseId } from "@/lib/chat/http";
import { getLiveRun, subscribe, type LiveEvent } from "@/lib/chat/live";
import { getOwnMessage } from "@/lib/chat/service";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events for one answer (REQ-CHAT-01). Attaches to the live run if it is still going (from any tab, after a
 * reload too); otherwise replays the stored result. Disconnecting does not stop the answer: that is what Stop is for.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await chatCaller(req, { mutating: false });
  if (caller instanceof Response) return caller;
  const id = parseId((await ctx.params).id);
  if (id == null) return json({ error: "Not found" }, 404);
  const db = await getDb();
  const own = await getOwnMessage(db, caller.session.user.id, id);
  if (!own || own.message.sender !== "assistant") return json({ error: "Not found" }, 404);

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: LiveEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const live = getLiveRun(id);
      if (live) {
        const heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(enc.encode(`: ping\n\n`));
        }, 15_000);
        const unsub = subscribe(id, (e) => {
          send(e);
          if (e.type === "done") setTimeout(close, 0);
        });
        cleanup = () => {
          clearInterval(heartbeat);
          unsub?.();
        };
        req.signal.addEventListener("abort", close, { once: true });
        if (!unsub) close();
        return;
      }

      // Not running in this process. A row still marked "streaming" means the server restarted mid-answer.
      let m = own.message;
      if (m.status === "streaming") {
        const [u] = await db
          .update(chatMessages)
          .set({ status: "error", errorCode: "interrupted", completedAt: new Date() })
          .where(eq(chatMessages.id, id))
          .returning();
        m = u ?? m;
      }
      send({ type: "snapshot", text: m.content, phase: "done", position: 0, activity: null });
      send({ type: "done", status: m.status === "streaming" ? "error" : m.status, errorCode: (m.errorCode as never) ?? null, text: m.content });
      close();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: do not buffer SSE
    },
  });
}
