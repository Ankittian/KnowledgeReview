import "./_env";
import { applySchema, createDb } from "@/db/client";

// Creates the tables on an empty database (db/schema.sql) and (re)creates the reporting views (db/views.sql).
const h = createDb();
try {
  const { created } = await applySchema(h);
  console.log(created ? "Empty database: tables created from db/schema.sql. Views created." : "Tables already exist (left untouched). Views refreshed.");
} finally {
  await h.close();
}
