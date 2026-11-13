import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { audit } from "@/lib/events";
import { json } from "@/lib/request";
import { loadEventsExport, loadFeedbackExport, loadKnowledgeExport, loadNeedsChange, loadReviewsExport, needsChangeMarkdown, toCsv, toJsonl } from "@/lib/reports";

const EXPORTS = ["needs-change", "feedback", "reviews", "knowledge", "events"] as const;
type ExportName = (typeof EXPORTS)[number];

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  if (session.user.role !== "admin") return json({ error: "Forbidden" }, 403);

  const { name } = await params;
  if (!EXPORTS.includes(name as ExportName)) return json({ error: "Unknown export" }, 404);
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "jsonl";
  if (!["jsonl", "csv", "md"].includes(format) || (format === "md" && name !== "needs-change")) return json({ error: "Unsupported format" }, 400);

  const db = await getDb();
  let rows: Record<string, unknown>[];
  let body: string | null = null;
  switch (name as ExportName) {
    case "needs-change": {
      const nc = await loadNeedsChange(db);
      if (format === "md") body = needsChangeMarkdown(nc);
      rows = nc as unknown as Record<string, unknown>[];
      break;
    }
    case "feedback":
      rows = await loadFeedbackExport(db, url.searchParams.get("status") ?? undefined);
      break;
    case "reviews":
      rows = await loadReviewsExport(db);
      break;
    case "knowledge":
      rows = await loadKnowledgeExport(db);
      break;
    case "events":
      rows = await loadEventsExport(db, { days: Number(url.searchParams.get("days")) || 30 });
      break;
  }
  if (body === null) body = format === "csv" ? toCsv(rows) : toJsonl(rows);
  await audit(db, session.user.id, "export", "export", name, { format, rows: rows.length });

  const stamp = new Date().toISOString().slice(0, 10);
  const type = format === "csv" ? "text/csv" : format === "md" ? "text/markdown" : "application/x-ndjson";
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${name}-${stamp}.${format}"`,
      "cache-control": "no-store",
    },
  });
}
