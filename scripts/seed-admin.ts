import "./_env";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { roleIdOf, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { normalizeUsername, usernameSchema, passwordSchema } from "@/lib/validation";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const username = normalizeUsername(arg("username") ?? process.env.ADMIN_USERNAME ?? "admin");
const password = arg("password") ?? process.env.ADMIN_PASSWORD;
usernameSchema.parse(username);

const h = createDb();
const [existing] = await h.db.select().from(users).where(eq(users.username, username));
if (existing && process.argv.includes("--if-missing")) {
  // Used on every deploy: never overwrite an admin whose password was changed in the app.
  console.log(`Admin '${username}' already exists, left unchanged.`);
  await h.close();
  process.exit(0);
}
if (!password) {
  await h.close();
  console.error("Set ADMIN_PASSWORD in .env or pass --password <value>.");
  process.exit(1);
}
passwordSchema.parse(password);
const passwordHash = await hashPassword(password);
if (existing) {
  await h.db.update(users).set({ passwordHash, roleId: roleIdOf("admin"), status: "active" }).where(eq(users.id, existing.id));
  console.log(`Admin '${username}' updated (password reset, role=admin, status=active).`);
} else {
  await h.db.insert(users).values({ username, passwordHash, displayName: "Administrator", roleId: roleIdOf("admin"), status: "active" });
  console.log(`Admin '${username}' created.`);
}
await h.close();
