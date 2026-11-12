import "./_env";
import { createDb, migrateDb } from "@/db/client";

const h = await createDb();
await migrateDb(h);
console.log(`Migrations + views applied (${h.kind}).`);
await h.close();
