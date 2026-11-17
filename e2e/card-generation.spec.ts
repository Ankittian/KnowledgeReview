import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "e2e-admin", password: "e2e-admin-password" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const skip = page.getByRole("button", { name: "Skip" }); // the first-login tour covers the page
  await skip.click({ timeout: 5000 }).catch(() => {});
  await expect(skip).toHaveCount(0);
}

/** The worker is a separate process; here it runs once with the mock model (no Claude credential needed). */
function runWorkerOnce() {
  execSync("npx tsx scripts/card-worker.ts --once", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, CLAUDE_RUNNER: "mock", CARDS_MOCK_DELAY_MS: "200", CARDS_OUTPUT_DIR: "test-results/generated-cards" },
  });
}

test("admin generates cards in the background, gets notified, edits, deletes and pushes", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "desktop flow");
  await login(page);

  // 1. New generation: form level, two forms, counts
  await page.goto("/admin/cards/new");
  await expect(page.getByTestId("audience-functional")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("audience-technical")).toBeEnabled(); // a technical prompt template exists
  await expect(page.getByRole("tab", { name: "Form level" })).toHaveAttribute("aria-selected", "true");
  await page.getByText("Select one or more forms…").click();
  await page.getByPlaceholder("Search forms…").fill("Material Receipt Note");
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.getByPlaceholder("Search forms…").fill("Gate Entry");
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("summary")).toContainText("2 forms · 16 cards"); // default 3 + 3 + 2 per form
  await page.getByTestId("generate").click();

  // 2. lands on the jobs list; the job is queued (nobody is working on it yet)
  await expect(page).toHaveURL(/\/admin\/cards$/);
  const row = page.getByTestId(/^job-\d+$/).first();
  await expect(row).toContainText("Queued");

  // 3. the worker finishes in the background; the list and the bell update by themselves
  runWorkerOnce();
  await expect(row).toContainText("Ready for review", { timeout: 20_000 });
  await expect(page.getByTestId("bell-count")).toHaveText("1", { timeout: 20_000 });
  await page.getByTestId("bell").click();
  const note = page.getByRole("dialog", { name: "Notifications" }).getByText(/Cards ready for review: 16 cards/); // the toast shows the same text
  await expect(note).toBeVisible();
  await note.click();

  // 4. review: delete one card, edit another
  await expect(page).toHaveURL(/\/admin\/cards\/\d+$/);
  await expect(page.getByTestId("push-summary")).toHaveText("16 cards will be pushed");
  const cards = page.locator("[data-testid^=card-]");
  const first = cards.first();
  const firstId = (await first.getAttribute("data-testid"))!.replace("card-", "");
  await page.getByTestId(`delete-${firstId}`).click();
  await expect(page.getByTestId("push-summary")).toHaveText("15 cards will be pushed");
  await expect(page.getByTestId(`undo-${firstId}`)).toBeVisible();

  const secondId = (await cards.nth(1).getAttribute("data-testid"))!.replace("card-", "");
  await page.getByTestId(`edit-${secondId}`).click();
  await page.getByTestId("edit-title").fill("What should the team check first when a split delivery reaches the stores?");
  await page.getByTestId("edit-save").click();
  await expect(page.getByTestId(`card-${secondId}`)).toContainText("edited");
  await expect(page.getByTestId(`card-${secondId}`)).toContainText("split delivery");

  // 5. push: the dialog shows the dry run, then the push runs
  await page.getByTestId("push-open").click();
  await expect(page.getByText("Push 15 cards to the database?")).toBeVisible();
  await expect(page.getByText("new cards", { exact: true })).toBeVisible();
  await page.getByTestId("push-confirm").click();
  await expect(page.getByText("Pushed", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("push-open")).toHaveCount(0);

  // 6. the cards are really in the database: Browse (any user) lists them
  await page.goto("/admin/cards");
  await expect(page.getByTestId(/^job-\d+$/).first()).toContainText("15 new");
});
