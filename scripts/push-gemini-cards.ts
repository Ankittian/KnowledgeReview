import "./_env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { cards, cardVersions, kbItems, cardFeedback, cardReviews, deckCards, reviewSchedule, cardRelatedItems, dailyDecks } from "../db/schema";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const ROOT = path.resolve("generate_cards_gemini");

interface CardItem {
  level: "easy" | "medium" | "hard";
  topic_key: string;
  title: string;
  body: string;
  source_refs?: string[];
}

interface CardFile {
  scope: "module" | "flow" | "form";
  key: string;
  title: string;
  context: string;
  module: string;
  audience: "functional" | "technical";
  cards: CardItem[];
}

function walkFiles(dir: string): string[] {
  let res: string[] = [];
  if (!fs.existsSync(dir)) return res;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) res.push(...walkFiles(full));
    else if (/\.(functional|technical)\.json$/.test(f)) res.push(full);
  }
  return res;
}

async function main() {
  const h = createDb();
  console.log("Connecting to Postgres...");

  try {
    const jsonFiles = walkFiles(ROOT);
    console.log(`Found ${jsonFiles.length} card JSON files under ${ROOT}`);

    if (!jsonFiles.length) {
      throw new Error(`No card files found under ${ROOT}`);
    }

    // Step 1: Remove old cards and dependent learning records
    console.log("Removing old cards and learning records from Postgres...");
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM learning.card_feedback`);
      await tx.execute(sql`DELETE FROM learning.card_reviews`);
      await tx.execute(sql`DELETE FROM learning.deck_cards`);
      await tx.execute(sql`DELETE FROM learning.daily_decks`);
      await tx.execute(sql`DELETE FROM learning.review_schedule`);
      await tx.execute(sql`DELETE FROM kb.card_related_items`);
      await tx.execute(sql`UPDATE kb.cards SET current_version_id = NULL`);
      await tx.execute(sql`DELETE FROM kb.card_versions`);
      await tx.execute(sql`DELETE FROM kb.cards`);
    });
    console.log("Old cards successfully removed.");

    // Step 2: Push new cards from generate_cards_gemini
    console.log("Pushing new cards into kb.cards and kb.card_versions...");
    let insertedCards = 0;
    const skippedFiles: string[] = [];

    for (const filePath of jsonFiles) {
      const cf: CardFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const scope = cf.scope ?? "form";
      const key = cf.key;

      const types = scope === "module" ? ["module"] : scope === "flow" ? ["process"] : ["form", "usercontrol"];

      const [item] = await h.db
        .select({ id: kbItems.id })
        .from(kbItems)
        .where(and(eq(kbItems.key, key), inArray(kbItems.type, types as ("module" | "process" | "form" | "usercontrol")[])));

      if (!item) {
        skippedFiles.push(`${scope}:${key} (from ${path.basename(filePath)})`);
        continue;
      }

      await h.db.transaction(async (tx) => {
        for (const c of cf.cards) {
          const id = `gen:${key}:${cf.audience}:${c.level}:${c.topic_key}`;
          const context = cf.context ?? cf.title ?? key;
          const hash = sha([context, c.title, c.body].join("\n␞\n"));

          await tx.insert(cards).values({
            id,
            kbItemId: item.id,
            kind: `generated.${c.level}`,
            sourceField: "generated",
            audience: cf.audience,
            level: c.level,
            topicKey: c.topic_key,
            status: "active"
          });

          const [v] = await tx
            .insert(cardVersions)
            .values({
              cardId: id,
              version: 1,
              context,
              front: c.title,
              back: c.body,
              sourceText: c.body,
              sourceHash: hash
            })
            .returning({ id: cardVersions.id });

          await tx.update(cards).set({ currentVersionId: v.id }).where(eq(cards.id, id));
          insertedCards++;
        }
      });
    }

    if (skippedFiles.length > 0) {
      console.warn("Skipped files due to missing kb_items:", skippedFiles);
    }

    console.log(`Successfully pushed ${insertedCards} cards from ${jsonFiles.length - skippedFiles.length} files.`);

    // Step 3: Verification queries
    console.log("\n================ VERIFICATION IN POSTGRES ================");
    const [cardCount] = await h.db.execute(sql`SELECT count(*)::int AS total FROM kb.cards`) as unknown as { total: number }[];
    const [versionCount] = await h.db.execute(sql`SELECT count(*)::int AS total FROM kb.card_versions`) as unknown as { total: number }[];
    const [healthCount] = await h.db.execute(sql`SELECT count(*)::int AS total FROM learning.card_health`) as unknown as { total: number }[];

    console.log(`kb.cards total: ${cardCount.total}`);
    console.log(`kb.card_versions total: ${versionCount.total}`);
    console.log(`learning.card_health (active cards in frontend): ${healthCount.total}`);

    const breakdown = await h.db.execute(sql`
      SELECT c.level, c.audience, count(*)::int AS count
      FROM kb.cards c
      GROUP BY c.level, c.audience
      ORDER BY c.level, c.audience
    `) as unknown as { level: string; audience: string; count: number }[];

    console.log("\nCard Breakdown in Postgres:");
    console.table(breakdown);

    const moduleBreakdown = await h.db.execute(sql`
      SELECT i.module, count(*)::int AS count
      FROM kb.cards c
      JOIN kb.kb_items i ON i.id = c.kb_item_id
      GROUP BY i.module
      ORDER BY i.module
    `) as unknown as { module: string; count: number }[];

    console.log("\nModule Breakdown in Postgres:");
    console.table(moduleBreakdown);

  } finally {
    await h.close();
  }
}

main().catch((err) => {
  console.error("Migration/Push Error:", err);
  process.exit(1);
});
