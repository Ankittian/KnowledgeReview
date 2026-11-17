/** Card generation end to end against the test database (needs TEST_DATABASE_URL; the database is wiped): queue, mock model, review, push. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { applySchema, createDb, resetDatabase, type DbHandle } from "@/db/client";
import { cards, generatedCards, kbItems, notifications, roleIdOf, users } from "@/db/schema";
import { MockGenClient, type GenClient, type GenerateRequest } from "@/lib/cards/generate/claude";
import { cancelJob, claimNextJob, createJob, editCard, getJob, JobError, loadCards, loadNotifications, requeueInterrupted, retryJob, setCardDeleted } from "@/lib/cards/generate/jobs";
import { loadLedger } from "@/lib/cards/generate/ledger";
import { loadGenerationOptions } from "@/lib/cards/generate/options";
import { previewPush, pushJob } from "@/lib/cards/generate/push";
import { processJob } from "@/lib/cards/generate/run";

let h: DbHandle;
let admin: string;
let dir: string;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Start Postgres (docker compose up -d) and set it in .env (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kr-gen-"));
});
afterAll(async () => {
  await h?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE kb_items, cards, card_versions, card_related_items, card_generation_jobs, generated_cards, notifications RESTART IDENTITY CASCADE`);
  await h.db.insert(kbItems).values([
    { type: "module", key: "MM", name: "Material Management", module: "MM", yamlFile: "modules.yaml", contentHash: "m" },
    { type: "form", key: "fGRN", name: "Material Receipt Note (GRN)", module: "MM", yamlFile: "forms/fGRN.yaml", contentHash: "a" },
    { type: "form", key: "fGateEntry", name: "Gate Entry", module: "MM", yamlFile: "forms/fGateEntry.yaml", contentHash: "b" },
  ]);
  if (!admin) {
    const [u] = await h.db.insert(users).values({ username: "gen-admin", passwordHash: "x", displayName: "Admin", roleId: roleIdOf("admin") }).returning({ id: users.id });
    admin = u.id;
  }
});

const formItem = (key: string, title: string, counts = { easy: 2, medium: 1, hard: 1 }) => ({ key, scope: "form", module: "MM", title, ...counts });
const request = { level: "form", model: "sonnet", instructions: "", items: [formItem("fGRN", "Material Receipt Note (GRN)"), formItem("fGateEntry", "Gate Entry")] };
const fast = (c: GenClient = new MockGenClient()) => c;

async function generate(input: unknown = request, client: GenClient = fast()) {
  const job = await createJob(h.db, admin, input);
  const claimed = await claimNextJob(h.db);
  expect(claimed?.id).toBe(job.id);
  await processJob(h.db, claimed!, client);
  return (await getJob(h.db, job.id))!;
}

process.env.CARDS_MOCK_DELAY_MS = "1";

describe("creating jobs", () => {
  it("queues a valid request and refuses a bad one", async () => {
    const job = await createJob(h.db, admin, request);
    expect(job.status).toBe("queued");
    await expect(createJob(h.db, admin, { ...request, items: [] })).rejects.toBeInstanceOf(JobError);
  });

  it("refuses a request over the per-job card cap", async () => {
    process.env.CARDS_MAX_PER_JOB = "5";
    try {
      await expect(createJob(h.db, admin, request)).rejects.toThrow(/at most 5/);
    } finally {
      delete process.env.CARDS_MAX_PER_JOB;
    }
  });

  it("refuses more jobs than the daily cap", async () => {
    process.env.CARDS_MAX_JOBS_PER_DAY = "2";
    try {
      await createJob(h.db, admin, request);
      await createJob(h.db, admin, request);
      await expect(createJob(h.db, admin, request)).rejects.toThrow(/limit is 2/);
    } finally {
      delete process.env.CARDS_MAX_JOBS_PER_DAY;
    }
  });

  it("hands each queued job to one worker, oldest first, and requeues an interrupted one", async () => {
    const a = await createJob(h.db, admin, request);
    const b = await createJob(h.db, admin, request);
    expect((await claimNextJob(h.db))?.id).toBe(a.id);
    expect((await claimNextJob(h.db))?.id).toBe(b.id);
    expect(await claimNextJob(h.db)).toBeNull();
    expect(await requeueInterrupted(h.db, 45)).toBe(0); // just started: another worker may be on it
    expect(await requeueInterrupted(h.db, -1)).toBe(2);
    expect((await claimNextJob(h.db))?.id).toBe(a.id);
  });

  it("cancels a queued job at once and asks a running one to stop; failed jobs can be retried", async () => {
    const a = await createJob(h.db, admin, request);
    expect(await cancelJob(h.db, a.id)).toBe("cancelled");
    expect(await cancelJob(h.db, a.id)).toBe("not_cancellable");
    expect(await retryJob(h.db, a.id)).toBe(true);
    await claimNextJob(h.db);
    expect(await cancelJob(h.db, a.id)).toBe("stopping");
  });
});

describe("generating", () => {
  it("stores the cards for review, reports progress and notifies the admin", async () => {
    const job = await generate();
    expect(job.status).toBe("ready");
    expect(job.progress).toEqual({ done: 1, total: 1 });
    expect(job.inputTokens).toBeGreaterThan(0);
    const rows = await loadCards(h.db, job.id);
    expect(rows).toHaveLength(8); // (2+1+1) per form, two forms
    expect(rows.filter((r) => r.groupKey === "fGRN" && r.level === "easy")).toHaveLength(2);
    expect(rows.every((r) => r.status === "draft")).toBe(true);
    const n = await loadNotifications(h.db, admin);
    expect(n.unread).toBe(1);
    expect(n.items[0]).toMatchObject({ kind: "cards_ready", jobId: job.id });
    expect(n.items[0].message).toMatch(/8 cards/);
  });

  it("generating does not touch the card tables", async () => {
    await generate();
    expect(await h.db.select().from(cards)).toHaveLength(0);
  });

  it("does module-level generation under the module item", async () => {
    const job = await generate({ level: "module", model: "sonnet", instructions: "", items: [{ key: "MM", scope: "module", module: "MM", title: "Material Management", easy: 2, medium: 1, hard: 0 }] });
    expect(job.status).toBe("ready");
    const rows = await loadCards(h.db, job.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.scope === "module" && r.groupKey === "MM")).toBe(true);
  });

  it("sends the existing titles of the chosen forms, and only those, to the model", async () => {
    const first = await generate();
    await pushJob(h.db, first.id, admin, { dir });
    const seen: string[] = [];
    const spy: GenClient = { generate: (req: GenerateRequest) => (seen.push(req.prompt), new MockGenClient().generate(req)) };
    await generate({ ...request, items: [formItem("fGRN", "Material Receipt Note (GRN)")] }, spy);
    const prompt = seen.find((p) => p.includes("EXISTING CARDS"))!;
    const ledgerLines = prompt.split("\n").filter((l) => l.startsWith("fGRN | "));
    expect(ledgerLines.length).toBe(4);
    expect(prompt.split("\n").some((l) => l.startsWith("fGateEntry | "))).toBe(false);
  });

  it("fails the job when the model keeps failing, and notifies", async () => {
    const broken: GenClient = { generate: async () => ({ ok: false, text: "", error: "usage limit", tokensIn: 0, tokensOut: 0 }) };
    const job = await generate(request, broken);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/usage limit/);
    expect((await loadNotifications(h.db, admin)).items[0].kind).toBe("cards_failed");
  });

  it("keeps the cards that worked when one batch fails, and lists the failure", async () => {
    let calls = 0;
    const flaky: GenClient = {
      generate: async (req) => (req.kind === "cards" && ++calls <= 2 ? { ok: false, text: "", error: "boom", tokensIn: 0, tokensOut: 0 } : new MockGenClient().generate(req)),
    };
    const many = Array.from({ length: 5 }, (_, i) => formItem(`fGateEntry${i}`, `Form ${i}`, { easy: 1, medium: 0, hard: 0 }));
    await h.db.insert(kbItems).values(many.map((m) => ({ type: "form" as const, key: m.key, name: m.title, module: "MM", yamlFile: `forms/${m.key}.yaml`, contentHash: m.key })));
    const job = await generate({ ...request, items: many }, flaky);
    expect(job.status).toBe("ready");
    expect((job.report as { failedBatches: unknown[] }).failedBatches).toHaveLength(1);
    expect(await loadCards(h.db, job.id)).toHaveLength(1); // only the second batch (one form)
  });

  it("drops cards beyond the requested counts and notes missing ones", async () => {
    const greedy: GenClient = {
      generate: async (req) => new MockGenClient().generate({ ...req, items: req.items?.map((i) => ({ ...i, easy: i.easy + 2, hard: 0 })) }),
    };
    const job = await generate({ ...request, items: [formItem("fGRN", "Material Receipt Note (GRN)")] }, greedy);
    const rows = await loadCards(h.db, job.id);
    expect(rows.filter((r) => r.level === "easy")).toHaveLength(2);
    const report = job.report as { dropped: unknown[]; shortfalls: { level: string }[] };
    expect(report.dropped.length).toBeGreaterThan(0);
    expect(report.shortfalls.some((s) => s.level === "hard")).toBe(true);
  });

  it("stops after a cancel request", async () => {
    const job = await createJob(h.db, admin, request);
    const claimed = (await claimNextJob(h.db))!;
    await cancelJob(h.db, job.id);
    await processJob(h.db, claimed, new MockGenClient());
    expect((await getJob(h.db, job.id))?.status).toBe("cancelled");
    expect(await loadCards(h.db, job.id)).toHaveLength(0);
  });
});

describe("audience", () => {
  const withTemplates = (audiences: string[]) => {
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), "kr-tpl-"));
    for (const a of audiences) fs.copyFileSync(path.resolve("data/templates/flashcards/generation-prompt.functional.txt"), path.join(tdir, `generation-prompt.${a}.txt`));
    process.env.CARDS_TEMPLATE_DIR = tdir;
    return () => {
      delete process.env.CARDS_TEMPLATE_DIR;
      fs.rmSync(tdir, { recursive: true, force: true });
    };
  };
  const technical = { ...request, audience: "technical" };

  it("refuses technical cards while there is no technical prompt template", async () => {
    const done = withTemplates(["functional"]);
    try {
      await expect(createJob(h.db, admin, technical)).rejects.toThrow(/no technical prompt template/);
      expect((await loadGenerationOptions(h.db)).audiences).toEqual(["functional"]);
    } finally {
      done();
    }
  });

  it("generates, previews and pushes technical cards as audience technical, apart from functional ones", async () => {
    const done = withTemplates(["functional", "technical"]);
    try {
      const fn = await generate();
      await pushJob(h.db, fn.id, admin, { dir });
      const tech = await generate(technical, new MockGenClient());
      expect(tech.params).toMatchObject({ audience: "technical" });
      // the functional cards are not in the technical ledger, and the other way round
      expect(await loadLedger(h.db, { module: "MM", itemKeys: ["fGRN"], audience: "technical" })).toHaveLength(2 + 1 + 1);
      expect(await loadLedger(h.db, { module: "MM", itemKeys: ["fGRN"], audience: "functional" })).toHaveLength(2 + 1 + 1);
      expect((await pushJob(h.db, tech.id, admin, { dir })).ok).toBe(true);
      const rows = await h.db.select({ audience: cards.audience }).from(cards);
      expect(rows.filter((r) => r.audience === "functional")).toHaveLength(8);
      expect(rows.filter((r) => r.audience === "technical")).toHaveLength(8);
      const file = (await getJob(h.db, tech.id))!.filePaths[0];
      expect(file).toMatch(/\.technical\.json$/);
      expect(JSON.parse(fs.readFileSync(path.join(dir, path.basename(file)), "utf8")).audience).toBe("technical");
    } finally {
      done();
    }
  });
});

describe("reviewing", () => {
  it("deletes and restores a card, and edits one with a re-check", async () => {
    const job = await generate();
    const [first, second] = await loadCards(h.db, job.id);
    expect((await setCardDeleted(h.db, first.id, true)).status).toBe("deleted");
    expect((await setCardDeleted(h.db, first.id, false)).status).toBe("draft");

    const edited = await editCard(h.db, second.id, { title: "A rewritten question about how the team receives goods?", body: "Too short.", level: second.level, topicKey: second.topicKey });
    expect(edited.edited).toBe(true);
    expect(edited.warnings.some((w) => /words/.test(w))).toBe(true);

    await expect(editCard(h.db, second.id, { title: " ", body: "x", level: second.level, topicKey: second.topicKey })).rejects.toThrow(/empty/);
    const clash = (await loadCards(h.db, job.id)).find((c) => c.id !== second.id && c.groupKey === second.groupKey && c.level === second.level)!;
    if (clash) await expect(editCard(h.db, second.id, { title: "x y", body: "x", level: second.level, topicKey: clash.topicKey })).rejects.toThrow(/already has/);
  });

  it("refuses changes once the job is no longer waiting for review", async () => {
    const job = await generate();
    const [c] = await loadCards(h.db, job.id);
    await pushJob(h.db, job.id, admin, { dir });
    await expect(setCardDeleted(h.db, c.id, true)).rejects.toThrow(/no longer/);
  });
});

describe("pushing", () => {
  it("previews without saving, then pushes only the cards that were not deleted and saves the file", async () => {
    const job = await generate();
    const rows = await loadCards(h.db, job.id);
    await setCardDeleted(h.db, rows[0].id, true);

    const preview = await previewPush(h.db, rows.filter((r) => r.id !== rows[0].id));
    expect(preview[0]).toMatchObject({ module: "MM", inserted: 7 });
    expect(await h.db.select().from(cards)).toHaveLength(0); // a dry run saves nothing

    const out = await pushJob(h.db, job.id, admin, { dir });
    expect(out.ok).toBe(true);
    const stored = await h.db.select().from(cards);
    expect(stored).toHaveLength(7);
    expect(stored.every((c) => c.audience === "functional" && c.status === "active")).toBe(true);

    const after = (await getJob(h.db, job.id))!;
    expect(after.status).toBe("pushed");
    expect(after.filePaths).toHaveLength(1);
    const file = JSON.parse(fs.readFileSync(path.join(dir, path.basename(after.filePaths[0])), "utf8"));
    expect(file.module).toBe("MM");
    expect(file.total_cards).toBe(7);

    expect((await loadNotifications(h.db, admin)).items.some((n) => n.kind === "cards_pushed")).toBe(true);
    expect(await pushJob(h.db, job.id, admin, { dir })).toMatchObject({ ok: false }); // not pushed twice
  });

  it("refuses a card too close to a stored one, marks it, and succeeds after it is deleted", async () => {
    const first = await generate({ ...request, items: [formItem("fGRN", "Material Receipt Note (GRN)", { easy: 1, medium: 0, hard: 0 })] });
    await pushJob(h.db, first.id, admin, { dir });
    const [stored] = await h.db.select().from(cards);
    expect(stored).toBeTruthy();

    const clone: GenClient = {
      generate: async (req) => {
        const res = await new MockGenClient().generate(req);
        const body = JSON.parse(res.text);
        const prior = (await loadCards(h.db, first.id))[0];
        if (req.kind === "cards") {
          body.items[0].cards[0].title = prior.title;
          body.items[0].cards[0].topic_key = "other--angle";
        }
        return { ...res, text: JSON.stringify(body) };
      },
    };
    const second = await generate({ ...request, items: [formItem("fGRN", "Material Receipt Note (GRN)", { easy: 1, medium: 0, hard: 0 })] }, clone);
    const [dup] = await loadCards(h.db, second.id);
    expect(dup.warnings.some((w) => /Similar/.test(w))).toBe(true);

    const refused = await pushJob(h.db, second.id, admin, { dir });
    expect(refused.ok).toBe(false);
    expect((await getJob(h.db, second.id))?.status).toBe("ready"); // back to review, nothing saved
    expect(await h.db.select().from(cards)).toHaveLength(1);
    expect((await loadCards(h.db, second.id))[0].warnings.some((w) => /Too close/.test(w))).toBe(true);

    await setCardDeleted(h.db, dup.id, true);
    expect(await pushJob(h.db, second.id, admin, { dir })).toMatchObject({ ok: false, error: expect.stringMatching(/no cards/) });
  });

  it("pushes several modules in one go", async () => {
    await h.db.insert(kbItems).values([
      { type: "module", key: "PM", name: "Production", module: "PM", yamlFile: "modules.yaml", contentHash: "pm" },
      { type: "form", key: "fJobCard", name: "Job Card", module: "PM", yamlFile: "forms/fJobCard.yaml", contentHash: "jc" },
    ]);
    const job = await generate({ ...request, items: [formItem("fGRN", "GRN", { easy: 1, medium: 0, hard: 0 }), { ...formItem("fJobCard", "Job Card", { easy: 1, medium: 0, hard: 0 }), module: "PM" }] });
    expect(job.status).toBe("ready");
    const out = await pushJob(h.db, job.id, admin, { dir });
    expect(out).toMatchObject({ ok: true });
    expect((await getJob(h.db, job.id))?.filePaths).toHaveLength(2);
    expect(await h.db.select().from(cards)).toHaveLength(2);
  });
});

describe("ledger and options", () => {
  it("lists stored titles for the chosen forms and pending cards of other jobs", async () => {
    const a = await generate({ ...request, items: [formItem("fGRN", "Material Receipt Note (GRN)", { easy: 1, medium: 0, hard: 0 })] });
    const pending = await loadLedger(h.db, { module: "MM", itemKeys: ["fGRN"] });
    expect(pending).toHaveLength(1); // generated, not pushed yet
    expect(await loadLedger(h.db, { module: "MM", itemKeys: ["fGRN"], excludeJobId: a.id })).toHaveLength(0);
    await pushJob(h.db, a.id, admin, { dir });
    expect(await loadLedger(h.db, { module: "MM", itemKeys: ["fGRN"] })).toHaveLength(1);
  });

  it("offers forms and modules with their card counts", async () => {
    const o = await loadGenerationOptions(h.db);
    expect(o.forms.map((f) => f.key).sort()).toEqual(["fGRN", "fGateEntry"]);
    expect(o.modules).toMatchObject([{ key: "MM", forms: 2 }]);
  });
});

describe("tables", () => {
  it("cascade-deletes a job's cards", async () => {
    const job = await generate();
    await h.db.execute(sql`DELETE FROM card_generation_jobs WHERE id = ${job.id}`);
    expect(await h.db.select().from(generatedCards).where(eq(generatedCards.jobId, job.id))).toHaveLength(0);
    expect((await h.db.select().from(notifications)).length).toBeGreaterThan(0); // notifications are independent
  });
});
