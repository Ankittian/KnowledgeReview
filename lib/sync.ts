import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { cardFeedback, cardRelatedItems, cards, cardVersions, kbItems } from "@/db/schema";
import { entityKey, type Catalog } from "@/lib/cards/build";

export interface SyncReport {
  entities: { inserted: number; updated: number; deactivated: number; reactivated: number };
  cards: { inserted: number; newVersions: number; metaUpdated: number; retired: number; reactivated: number };
  links: { inserted: number; deleted: number };
  staleFeedback: number;
  totalCards: number;
  changed: boolean;
}

const CHUNK = 400;
function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Upserts the catalog into the database. Idempotent: a second run with the same YAML changes nothing.
 * - changed card text  -> new card_version (old reviews keep pointing at the version they saw),
 *                         open feedback on the card becomes `stale` (re-verify against the new text)
 * - card no longer produced -> `retired`;  entity no longer in YAML -> `active=false`
 */
export async function syncCatalog(db: DB, catalog: Catalog): Promise<SyncReport> {
  const report: SyncReport = {
    entities: { inserted: 0, updated: 0, deactivated: 0, reactivated: 0 },
    cards: { inserted: 0, newVersions: 0, metaUpdated: 0, retired: 0, reactivated: 0 },
    links: { inserted: 0, deleted: 0 },
    staleFeedback: 0,
    totalCards: catalog.cards.length,
    changed: false,
  };

  await db.transaction(async (tx) => {
    // ---- entities ---------------------------------------------------------------------------
    const existing = await tx.select().from(kbItems);
    const byKey = new Map(existing.map((e) => [`${e.type}:${e.key}`, e]));
    const wanted = new Set(catalog.entities.map(entityKey));

    const toInsert = catalog.entities.filter((e) => !byKey.has(entityKey(e)));
    const insertedKeys = new Set(toInsert.map(entityKey));
    for (const part of chunks(toInsert)) {
      const rows = await tx
        .insert(kbItems)
        .values(part.map((e) => ({ type: e.type, key: e.key, name: e.name, module: e.module, yamlFile: e.yamlFile, contentHash: e.contentHash, meta: e.meta })))
        .returning();
      rows.forEach((r) => byKey.set(`${r.type}:${r.key}`, r));
      report.entities.inserted += rows.length;
    }
    for (const e of catalog.entities) {
      const cur = byKey.get(entityKey(e))!;
      if (insertedKeys.has(entityKey(e))) continue;
      const changed =
        cur.contentHash !== e.contentHash || cur.name !== e.name || cur.module !== e.module || cur.yamlFile !== e.yamlFile || !cur.active;
      if (!changed) continue;
      if (!cur.active) report.entities.reactivated++;
      else report.entities.updated++;
      await tx
        .update(kbItems)
        .set({ name: e.name, module: e.module, yamlFile: e.yamlFile, contentHash: e.contentHash, meta: e.meta, active: true })
        .where(eq(kbItems.id, cur.id));
    }
    const gone = existing.filter((e) => e.active && !wanted.has(`${e.type}:${e.key}`));
    if (gone.length) {
      await tx.update(kbItems).set({ active: false }).where(inArray(kbItems.id, gone.map((e) => e.id)));
      report.entities.deactivated = gone.length;
    }
    const entityId = (r: { type: string; key: string }) => byKey.get(`${r.type}:${r.key}`)!.id;

    // ---- cards & versions ------------------------------------------------------------------------
    const curCards = await tx
      .select({
        id: cards.id,
        kbItemId: cards.kbItemId,
        audience: cards.audience,
        kind: cards.kind,
        sourceField: cards.sourceField,
        status: cards.status,
        versionId: cards.currentVersionId,
        version: cardVersions.version,
        sourceHash: cardVersions.sourceHash,
      })
      .from(cards)
      .leftJoin(cardVersions, eq(cardVersions.id, cards.currentVersionId));
    const cardById = new Map(curCards.map((c) => [c.id, c]));
    const wantedCards = new Set(catalog.cards.map((c) => c.id));

    const newCards = catalog.cards.filter((c) => !cardById.has(c.id));
    for (const part of chunks(newCards)) {
      await tx.insert(cards).values(
        part.map((c) => ({ id: c.id, kbItemId: entityId(c.entity), kind: c.kind, sourceField: c.sourceField })),
      );
      const vers = await tx
        .insert(cardVersions)
        .values(part.map((c) => ({ cardId: c.id, version: 1, context: c.context, front: c.front, back: c.back, sourceText: c.sourceText, sourceHash: c.sourceHash })))
        .returning({ id: cardVersions.id, cardId: cardVersions.cardId });
      // set current_version_id in one statement per chunk
      const values = sql.join(
        vers.map((v) => sql`(${v.cardId}, ${v.id}::int)`),
        sql`, `,
      );
      await tx.execute(
        sql`UPDATE cards SET current_version_id = v.vid FROM (VALUES ${values}) AS v(cid, vid) WHERE cards.id = v.cid`,
      );
      report.cards.inserted += part.length;
    }

    for (const c of catalog.cards) {
      const cur = cardById.get(c.id);
      if (!cur) continue;
      const eid = entityId(c.entity);
      if (cur.sourceHash !== c.sourceHash) {
        const [v] = await tx
          .insert(cardVersions)
          .values({ cardId: c.id, version: (cur.version ?? 0) + 1, context: c.context, front: c.front, back: c.back, sourceText: c.sourceText, sourceHash: c.sourceHash })
          .returning({ id: cardVersions.id });
        await tx.update(cards).set({ currentVersionId: v.id }).where(eq(cards.id, c.id));
        const stale = await tx
          .update(cardFeedback)
          .set({ status: "stale", resolutionNote: "Source text changed in a knowledge-base sync; re-verify against the new version.", resolvedAt: new Date() })
          .where(
            and(
              eq(cardFeedback.status, "open"),
              inArray(cardFeedback.cardVersionId, tx.select({ id: cardVersions.id }).from(cardVersions).where(eq(cardVersions.cardId, c.id))),
            ),
          )
          .returning({ id: cardFeedback.id });
        report.staleFeedback += stale.length;
        report.cards.newVersions++;
      }
      const metaChanged = cur.kbItemId !== eid || cur.kind !== c.kind || cur.sourceField !== c.sourceField;
      if (metaChanged || cur.status !== "active") {
        if (cur.status !== "active") report.cards.reactivated++;
        else report.cards.metaUpdated++;
        await tx
          .update(cards)
          .set({ kbItemId: eid, kind: c.kind, sourceField: c.sourceField, status: "active" })
          .where(eq(cards.id, c.id));
      }
    }
    // generated cards (audience set) belong to scripts/cards/load-cards.ts, not to this template sync
    const retire = curCards.filter((c) => c.status === "active" && !c.audience && !wantedCards.has(c.id)).map((c) => c.id);
    for (const part of chunks(retire)) {
      await tx.update(cards).set({ status: "retired" }).where(inArray(cards.id, part));
    }
    report.cards.retired = retire.length;

    // ---- links (backend-only traceability) ----------------------------------------------------
    const curLinks = await tx.select().from(cardRelatedItems);
    const lk = (cardId: string, eid: number, rel: string) => `${cardId}\u0000${eid}\u0000${rel}`;
    const have = new Map(curLinks.map((l) => [lk(l.cardId, l.kbItemId, l.relation), l]));
    const want = new Map<string, { cardId: string; kbItemId: number; relation: string }>();
    for (const c of catalog.cards)
      for (const l of c.links) {
        const row = { cardId: c.id, kbItemId: entityId(l), relation: l.relation };
        want.set(lk(row.cardId, row.kbItemId, row.relation), row);
      }
    const addLinks = [...want.entries()].filter(([k]) => !have.has(k)).map(([, v]) => v);
    for (const part of chunks(addLinks, 1000)) await tx.insert(cardRelatedItems).values(part);
    report.links.inserted = addLinks.length;
    const delLinks = [...have.entries()].filter(([k]) => !want.has(k)).map(([, v]) => v);
    for (const l of delLinks)
      await tx
        .delete(cardRelatedItems)
        .where(and(eq(cardRelatedItems.cardId, l.cardId), eq(cardRelatedItems.kbItemId, l.kbItemId), eq(cardRelatedItems.relation, l.relation)));
    report.links.deleted = delLinks.length;
  });

  const { entities: e, cards: c, links: l } = report;
  report.changed =
    e.inserted + e.updated + e.deactivated + e.reactivated + c.inserted + c.newVersions + c.metaUpdated + c.retired + c.reactivated + l.inserted + l.deleted > 0;
  return report;
}
