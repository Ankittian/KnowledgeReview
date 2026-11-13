import { sql, type SQL } from "drizzle-orm";
import type { Role } from "@/lib/auth/types";
import type { Audience } from "./spec";

export const AUDIENCES: Audience[] = ["functional", "technical"];

/**
 * Which card sets a user may receive. Decided from the signed-in role on the server, never from the client.
 * technical -> technical; admin -> both; everyone else (functional, employee, reviewer) -> functional (the safe default:
 * a business user must never get a technical card).
 */
export function audiencesFor(role: Role): Audience[] {
  if (role === "admin") return ["functional", "technical"];
  if (role === "technical") return ["technical"];
  return ["functional"];
}

/** Admins may narrow the view to one set (?audience=functional|technical); everyone else always gets their own set. */
export function pickAudiences(role: Role, requested?: string | null): Audience[] {
  if (role === "admin" && (requested === "functional" || requested === "technical")) return [requested];
  return audiencesFor(role);
}

/** SQL: `<col> IN ('functional', ...)`. A NULL audience (legacy template card) never matches. */
export const audienceIn = (col: SQL | string, audiences: Audience[]): SQL =>
  sql`${typeof col === "string" ? sql.raw(col) : col}::text IN (${sql.join(audiences.map((a) => sql`${a}`), sql`, `)})`;
