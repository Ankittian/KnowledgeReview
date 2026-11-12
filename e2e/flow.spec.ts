import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "e2e-admin", password: "e2e-admin-password" };
const PASSWORD = "employee-pass-123";
const COMMENT = "E2E: the field label is wrong";

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The employee-facing HTML / RSC payload must not contain traceability details. */
function assertNoTraceability(html: string) {
  for (const needle of ["rule.summary:", "form.field:", "form.validation:", "concept.summary:", "process.next:", "rules.yaml", "forms/f", "applies_to", "entity_id", "card_links"]) {
    expect(html, `leaked "${needle}"`).not.toContain(needle);
  }
}

test("sign-up → approval → daily deck → feedback → traceable 'needs change'", async ({ page, browser }, info) => {
  const username = `e2e-${info.project.name}`;
  const mobile = info.project.name === "mobile";
  const comment = `${COMMENT} (${info.project.name})`;

  // 1. sign up → pending
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(`E2E ${info.project.name}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Department").fill("Stores");
  await page.getByLabel("Main area").selectOption("MM");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Request account" }).click();
  await expect(page).toHaveURL(/\/pending/);
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();

  // 2. cannot get in before approval
  await login(page, username, PASSWORD);
  await expect(page).toHaveURL(/\/pending/);

  // 3. admin approves (separate browser context)
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.username, ADMIN.password);
  await expect(admin).toHaveURL(/\/today/);
  await admin.goto("/admin/users");
  const card = admin.getByTestId("pending-user").filter({ hasText: username });
  await card.getByTestId("approve").click();
  await expect(admin.getByTestId("pending-user").filter({ hasText: username })).toHaveCount(0);

  // 4. employee signs in and completes the deck
  await login(page, username, PASSWORD);
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByRole("heading", { name: "Today’s cards" })).toBeVisible();
  assertNoTraceability(await page.content());

  const reviewBodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/reviews") && r.method() === "POST") reviewBodies.push(JSON.parse(r.postData() ?? "{}"));
  });

  for (let i = 0; i < 10; i++) {
    await expect(page.getByText(`${i}/10`, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("flashcard")).toHaveCount(1); // previous card's exit animation finished
    if (i % 2 === 0) await page.getByTestId("reveal").click();
    else if (mobile) await page.getByTestId("flashcard").click();
    else await page.keyboard.press("Space");
    await expect(page.getByTestId("knew-yes")).toBeVisible();

    if (mobile && i === 3) {
      // swipe right = knew it
      const box = (await page.getByTestId("flashcard").boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width / 2, y);
      await page.mouse.down();
      for (let s = 1; s <= 8; s++) await page.mouse.move(box.x + box.width / 2 + s * 30, y);
      await page.mouse.up();
      await expect(page.getByTestId("knew-yes")).toHaveAttribute("aria-pressed", "true");
    } else if (!mobile && i % 3 === 1) {
      await page.keyboard.press("ArrowLeft");
    } else {
      await page.getByTestId(i % 4 === 0 ? "knew-no" : "knew-yes").click();
    }

    if (i === 1) {
      await page.getByTestId("verdict-improve").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("radio", { name: /Incorrect/ }).click();
      await dialog.getByLabel(/Suggested correction/).fill("E2E corrected text for this card.");
      await dialog.getByLabel(/Comment/).fill(comment);
      await dialog.getByRole("button", { name: "Submit" }).click();
      await expect(dialog).toBeHidden();
    } else if (i === 5 && !mobile) {
      await page.keyboard.press("u");
    } else {
      await page.getByTestId("verdict-correct").click();
    }
  }
  await expect(page.getByTestId("deck-complete")).toBeVisible();

  // outbox fully flushed
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("kr_outbox_v1")), { timeout: 30_000 }).toBe("[]");

  // requests carry only opaque ids (card version, deck); responses carry no traceability either
  expect(reviewBodies).toHaveLength(10);
  for (const b of reviewBodies) {
    expect(Object.keys(b).sort()).toEqual(["answeredAt", "clientEventId", "deckDate", "deckId", "device", "feedback", "flippedAt", "knewIt", "shownAt", "verdict", "versionId"]);
    expect(typeof b.deckId).toBe("number");
  }
  // replaying an answer is idempotent, and the response carries no traceability
  const origin = new URL(page.url()).origin;
  const replay = await page.request.post("/api/reviews", { data: reviewBodies[0], headers: { origin } });
  expect(replay.status()).toBe(200);
  const rj = await replay.json();
  expect(Object.keys(rj).sort()).toEqual(["deckCompleted", "duplicate", "ok"]);
  expect(rj.duplicate).toBe(true);
  // CSRF: a cross-site POST is refused
  const csrf = await page.request.post("/api/reviews", { data: reviewBodies[0], headers: { origin: "https://evil.example" } });
  expect(csrf.status()).toBe(403);

  // reload: deck stays complete (answers persisted server-side)
  await page.reload();
  await expect(page.getByTestId("deck-complete")).toBeVisible();

  // progress, browse and employee pages also free of traceability
  for (const p of ["/progress", "/browse?q=unit"]) {
    await page.goto(p);
    assertNoTraceability(await page.content());
  }
  await page.goto("/admin/health");
  await expect(page).toHaveURL(/\/today/); // employees can't open admin

  // 5. admin sees it, traceable to YAML file + key + field
  const res = await admin.request.get("/api/admin/export/needs-change?format=jsonl");
  expect(res.ok()).toBe(true);
  const rows = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const mine = rows.find((r) => r.suggestions.some((s: { comment: string; username: string }) => s.comment === comment && s.username === username));
  expect(mine, "flagged row for this user").toBeTruthy();
  expect(mine.yaml_file).toMatch(/\.yaml$/);
  expect(mine.entity_key).toBeTruthy();
  expect(mine.field).toBeTruthy();
  expect(mine.improve_votes).toBeGreaterThanOrEqual(1);
  expect(["rule", "concept", "process"]).toContain(mine.entity_type); // only business-level cards are issued
  if (mine.entity_type !== "concept") expect(mine.linked_forms.length + mine.linked_processes.length).toBeGreaterThan(0);

  await admin.goto("/admin/health");
  await expect(admin.getByText(mine.entity_name).first()).toBeVisible();
  await admin.goto("/admin/feedback");
  const item = admin.getByTestId("feedback-item").filter({ hasText: comment });
  await expect(item).toContainText(mine.yaml_file);
  await expect(item).toContainText("E2E corrected text for this card.");
  await item.getByRole("button", { name: "Accept" }).click();
  await admin.goto("/admin/feedback?status=accepted");
  await expect(admin.getByTestId("feedback-item").filter({ hasText: comment })).toBeVisible();

  // drill-down page for the flagged entity
  await admin.goto(`/admin/health/${mine.entity_type === "usercontrol" ? "form" : mine.entity_type}/${encodeURIComponent(mine.entity_key)}`);
  await expect(admin.getByText(mine.yaml_file, { exact: false }).first()).toBeVisible();

  // 6. every interaction was logged
  const ev = await admin.request.get("/api/admin/export/events?format=jsonl");
  const events = (await ev.text()).trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.username === username);
  const count = (t: string) => events.filter((e) => e.event_type === t).length;
  expect(count("signup")).toBe(1);
  expect(count("login_pending")).toBe(1);
  expect(count("login")).toBe(1);
  expect(count("deck_started")).toBe(1);
  expect(count("card_shown")).toBeGreaterThanOrEqual(10);
  expect(count("card_flipped")).toBe(10);
  expect(count("knew_answered")).toBeGreaterThanOrEqual(10);
  expect(count("review_submitted")).toBe(10);
  expect(count("feedback_opened")).toBe(1);
  expect(count("feedback_submitted")).toBe(1);
  expect(count("deck_completed")).toBe(1);
  expect(events.filter((e) => e.event_type === "card_flipped").every((e) => !!e.card_id)).toBe(true);

  // team knowledge reflects the answers
  const kn = await admin.request.get("/api/admin/export/knowledge?format=jsonl");
  const krow = (await kn.text()).trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.username === username);
  expect(krow.reviews).toBe(10);

  // 7. signing in again the same day: daily limit (10) already used up
  await page.goto("/today");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, username, PASSWORD);
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByTestId("deck-complete")).toContainText("limit of 10 cards");

  // 8. admin raises the daily limit -> the employee gets a fresh random top-up right away
  await admin.goto("/admin/settings");
  await admin.getByLabel("Cards per day").fill("12");
  await admin.getByTestId("save-daily-limit").click();
  await expect(admin.getByLabel("Cards per day")).toHaveValue("12");
  await page.reload();
  await expect(page.getByTestId("reveal")).toBeVisible();
  await expect(page.getByText("10/12", { exact: true })).toBeVisible();
  // restore for the next project
  await admin.getByLabel("Cards per day").fill("10");
  await admin.getByTestId("save-daily-limit").click();
  await expect(admin.getByLabel("Cards per day")).toHaveValue("10");
  await adminCtx.close();
});
