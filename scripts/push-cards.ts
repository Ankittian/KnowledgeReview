/**
 * push-cards.ts
 *
 * Canonical script to push generated flashcard catalogs (JSON) into Postgres (knowledge_review_final).
 *
 * Usage:
 *   npx tsx scripts/push-cards.ts [file1.json file2.json ...]
 *
 * If no files are specified, it defaults to all *.json files in `generated_claude_cards/`.
 *
 * Workflow for each module:
 *   1. Identifies and safely removes any existing cards and dependent rows for the target module.
 *   2. Ensures required flow/module entities exist in kb_items.
 *   3. Inserts all cards and card versions.
 *   4. Establishes knowledge graph links in card_related_items from card source_refs.
 *   5. Verifies and prints a clean summary table of database status.
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client";
import {
  cards,
  cardVersions,
  cardRelatedItems,
  deckCards,
  reviewSchedule,
  cardReviews,
  cardFeedback,
  kbItems,
} from "../db/schema";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

interface CardItem {
  level: "easy" | "medium" | "hard";
  topic_key: string;
  title: string;
  body: string;
  source_refs?: string[];
}

interface CardGroup {
  scope: "module" | "flow" | "form";
  key: string;
  title: string;
  context: string;
  cards: CardItem[];
}

interface UnifiedCatalog {
  module: string;
  title: string;
  audience: "functional" | "technical";
  total_cards: number;
  breakdown: Record<string, number>;
  items: CardGroup[];
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
};

async function main() {
  const args = process.argv.slice(2);
  let filesToProcess: string[] = [];

  if (args.length > 0) {
    filesToProcess = args;
  } else {
    const claudeDir = path.resolve("generated_claude_cards");
    if (fs.existsSync(claudeDir)) {
      filesToProcess = fs
        .readdirSync(claudeDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join("generated_claude_cards", f));
    }
  }

  if (filesToProcess.length === 0) {
    console.error("No JSON card catalog files found to process.");
    process.exit(1);
  }

  const h = createDb();
  console.log("Connecting to Postgres (knowledge_review_final)...");

  try {
    for (const fileRel of filesToProcess) {
      const fullPath = path.resolve(fileRel);
      if (!fs.existsSync(fullPath)) {
        console.warn(`File not found: ${fullPath}, skipping.`);
        continue;
      }

      const catalog: UnifiedCatalog = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      const mod = catalog.module;
      console.log(`\n========================================================`);
      console.log(`Processing: ${fileRel}`);
      console.log(`Module: ${mod} | Audience: ${catalog.audience} | Total Cards: ${catalog.total_cards}`);

      // ── 1. Remove existing cards for this module ──────────────────────────
      const existingCards = await h.db
        .select({ id: cards.id })
        .from(cards)
        .innerJoin(kbItems, eq(cards.kbItemId, kbItems.id))
        .where(eq(kbItems.module, mod));

      const cardIds = existingCards.map((r) => r.id);
      if (cardIds.length > 0) {
        console.log(`Purging ${cardIds.length} existing cards for module ${mod}...`);
        const cardIdChunks = chunk(cardIds, 500);

        // Fetch version IDs
        const versionRows = await h.db
          .select({ id: cardVersions.id })
          .from(cardVersions)
          .where(inArray(cardVersions.cardId, cardIds));
        const versionIds = versionRows.map((r) => r.id);
        const versionIdChunks = chunk(versionIds, 500);

        for (const vchunk of versionIdChunks) {
          await h.db.delete(cardFeedback).where(inArray(cardFeedback.cardVersionId, vchunk));
          await h.db.delete(cardReviews).where(inArray(cardReviews.cardVersionId, vchunk));
        }

        for (const cchunk of cardIdChunks) {
          await h.db.delete(deckCards).where(inArray(deckCards.cardId, cchunk));
          await h.db.delete(reviewSchedule).where(inArray(reviewSchedule.cardId, cchunk));
          await h.db.delete(cardRelatedItems).where(inArray(cardRelatedItems.cardId, cchunk));
        }

        for (const cchunk of cardIdChunks) {
          await h.db.update(cards).set({ currentVersionId: null }).where(inArray(cards.id, cchunk));
          await h.db.delete(cardVersions).where(inArray(cardVersions.cardId, cchunk));
          await h.db.delete(cards).where(inArray(cards.id, cchunk));
        }
        console.log(`  Purged existing ${mod} cards and associated dependencies.`);
      }

      // ── 2. Push new cards from catalog ────────────────────────────────────
      let cardsInserted = 0;
      let relatedLinksInserted = 0;

      for (const group of catalog.items) {
        const scope = group.scope;
        const key = group.key;

        // Find or create kb_item
        let [kbItem] = await h.db
          .select({ id: kbItems.id })
          .from(kbItems)
          .where(eq(kbItems.key, key))
          .limit(1);

        if (!kbItem) {
          const itemType = scope === "flow" ? "process" : scope === "module" ? "module" : "form";
          const yamlFile = group.cards[0]?.source_refs?.[0] ?? `processes/${key}.yaml`;
          const contentHash = sha([key, group.title, group.context].join(":"));

          const [inserted] = await h.db
            .insert(kbItems)
            .values({
              type: itemType,
              key: key,
              name: group.title,
              module: mod,
              yamlFile: yamlFile,
              contentHash: contentHash,
              meta: { scope: group.scope, context: group.context, generated: true },
              active: true,
              lastSyncedAt: new Date(),
            })
            .returning({ id: kbItems.id });
          kbItem = inserted;
        }

        for (const c of group.cards) {
          const cardId = `gen:${key}:${catalog.audience}:${c.level}:${c.topic_key}`;
          const context = group.context ?? group.title ?? key;
          const hash = sha([context, c.title, c.body].join("\n␞\n"));

          await h.db.insert(cards).values({
            id: cardId,
            kbItemId: kbItem.id,
            kind: `generated.${c.level}`,
            sourceField: "generated",
            audience: catalog.audience,
            level: c.level,
            topicKey: c.topic_key,
            status: "active",
          });

          const [v] = await h.db
            .insert(cardVersions)
            .values({
              cardId: cardId,
              version: 1,
              context: context,
              front: c.title,
              back: c.body,
              sourceText: c.body,
              sourceHash: hash,
            })
            .returning({ id: cardVersions.id });

          await h.db.update(cards).set({ currentVersionId: v.id }).where(eq(cards.id, cardId));
          cardsInserted++;

          if (c.source_refs && c.source_refs.length > 0) {
            for (const ref of c.source_refs) {
              let [relatedKb] = await h.db
                .select({ id: kbItems.id })
                .from(kbItems)
                .where(eq(kbItems.yamlFile, ref))
                .limit(1);

              if (!relatedKb && ref.startsWith("rule:")) {
                const ruleKey = ref.replace("rule:", "");
                [relatedKb] = await h.db
                  .select({ id: kbItems.id })
                  .from(kbItems)
                  .where(and(eq(kbItems.type, "rule"), eq(kbItems.key, ruleKey)))
                  .limit(1);
              }

              if (!relatedKb) {
                [relatedKb] = await h.db
                  .select({ id: kbItems.id })
                  .from(kbItems)
                  .where(eq(kbItems.key, ref))
                  .limit(1);
              }

              if (relatedKb) {
                await h.db
                  .insert(cardRelatedItems)
                  .values({
                    cardId: cardId,
                    kbItemId: relatedKb.id,
                    relation: "source",
                  })
                  .onConflictDoNothing();
                relatedLinksInserted++;
              }
            }
          }
        }
      }

      console.log(`Inserted ${cardsInserted} cards and ${relatedLinksInserted} knowledge links for ${mod}.`);
    }

    // ── 3. Post-push Verification ───────────────────────────────────────────
    console.log(`\n========================================================`);
    console.log(`DATABASE SUMMARY:`);
    const summary = await h.db.execute(sql`
      SELECT 
        COALESCE(i.module, 'UNKNOWN') AS module,
        c.audience,
        c.level,
        count(*)::int AS count
      FROM cards c
      JOIN kb_items i ON i.id = c.kb_item_id
      GROUP BY i.module, c.audience, c.level
      ORDER BY i.module, c.audience, c.level
    `);
    console.table(summary);

    const [cardCount] = await h.db.execute(sql`SELECT count(*)::int AS n FROM cards WHERE status = 'active'`);
    const [viewCount] = await h.db.execute(sql`SELECT count(*)::int AS n FROM card_health`);
    console.log(`Total Active Cards: ${(cardCount as any).n} | card_health rows: ${(viewCount as any).n}`);
  } finally {
    await h.close();
  }
}

main().catch((err) => {
  console.error("Error pushing cards:", err);
  process.exit(1);
});
