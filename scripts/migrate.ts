import "./_env";
import { createDb, migrateDb } from "@/db/client";

const h = createDb();
await migrateDb(h);
console.log(`Migrations + views applied.`);
await h.close();
