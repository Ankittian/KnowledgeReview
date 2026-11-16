import { sql, type SQL } from "drizzle-orm";
import type { Role } from "@/lib/auth/types";
import type { Audience } from "./spec";

export const AUDIENCES: Audience[] = ["functional", "technical"];

/**
 * Which card sets a user may receive. Decided from the signed-in role on the server, never from the client.
 * admin and technical -> both; everyone else (functional, employee, reviewer) -> functional (the safe default:
 * a business user must never get a technical card).
 */
export function audiencesFor(role: Role): Audience[] {
  if (role === "admin" || role === "technical") return ["functional", "technical"];
  return ["functional"];
}

/** Roles that may see both card sets and switch between them. */
export const canSwitchSets = (role: Role): boolean => role === "admin" || role === "technical";

/** Admin and technical users may narrow the view to one set (?audience=functional|technical); everyone else always gets their own set. */
export function pickAudiences(role: Role, requested?: string | null): Audience[] {
  if (canSwitchSets(role) && (requested === "functional" || requested === "technical")) return [requested];
  return audiencesFor(role);
}

/** SQL: `<col> IN ('functional', ...)`. A NULL audience (legacy template card) never matches. */
export const audienceIn = (col: SQL | string, audiences: Audience[]): SQL =>
  sql`${typeof col === "string" ? sql.raw(col) : col}::text IN (${sql.join(audiences.map((a) => sql`${a}`), sql`, `)})`;
