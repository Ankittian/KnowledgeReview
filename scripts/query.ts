import "./_env";
import { sql } from "drizzle-orm";
import { createDb, query } from "@/db/client";

// Run one read-only SQL query and print the rows.  npm run db:query -- "SELECT * FROM v_needs_change LIMIT 5"
const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Usage: npm run db:query -- "SELECT ..."');
  process.exit(1);
}
if (!/^\s*(select|with|table|explain)\b/i.test(text)) {
  console.error("Only read-only queries (SELECT / WITH / TABLE / EXPLAIN) are allowed here.");
  process.exit(1);
}
const h = await createDb();
try {
  const rows = await h.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return query<Record<string, unknown>>(tx as never, sql.raw(text));
  });
  const flat = rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => {
        const s = v instanceof Date ? v.toISOString() : typeof v === "object" && v !== null ? JSON.stringify(v) : v;
        return [k, typeof s === "string" && s.length > 80 ? `${s.slice(0, 77)}...` : s];
      }),
    ),
  );
  console.table(flat);
  console.log(`${rows.length} row(s) · ${h.kind}`);
} finally {
  await h.close();
}
