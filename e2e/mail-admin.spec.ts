import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "e2e-admin", password: "e2e-admin-password" };
const PASS = "secret-pass-123";

async function dismissTour(page: Page) {
  try {
    await page.getByRole("button", { name: "Close walkthrough" }).click({ timeout: 3000 });
  } catch {
    /* already seen */
  }
}

const row = (page: Page, name: string) => page.getByTestId("mail-connection").filter({ hasText: name });

/** Open a toggle such as "Server settings" (no-op when it is already open). */
async function expand(page: Page, name: string | RegExp) {
  const btn = page.getByRole("button", { name }).first();
  if ((await btn.getAttribute("aria-expanded")) === "false") await btn.click();
}

async function fillConnection(page: Page, name: string, host: string, port: string, email: string) {
  await expand(page, "Server settings");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Host").fill(host);
  await page.getByLabel("Port").fill(port);
  await page.getByLabel("Username").fill(email);
  await page.getByLabel("Password").fill(PASS);
  await page.getByLabel("Email address").fill(email);
}

async function addConnection(page: Page, preset: string, name: string, host: string, port: string, email: string, activate?: boolean) {
  await page.getByRole("button", { name: preset, exact: true }).click();
  await expect(page.getByTestId("mail-hint")).toContainText(preset === "Gmail" ? "app password" : "Authenticated SMTP"); // provider hint for the chosen preset
  await fillConnection(page, name, host, port, email);
  if (activate !== undefined) await page.getByLabel("Use this connection for sending now").setChecked(activate);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByTestId("mail-saved")).toBeVisible();
}

test("admin saves several email connections, switches between them, tests, edits and deletes", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // the "are you sure?" prompts

  await page.goto("/login");
  await page.getByLabel("Username or email").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(today|chat)/);
  await page.goto("/admin/settings?tab=email");
  await dismissTour(page);

  // nothing configured yet (the test database starts empty)
  await expect(page.getByTestId("mail-status")).toContainText("Email is not configured");

  // 1. add a connection: the very first one becomes active; a closed port makes the test fail with a clear message
  await addConnection(page, "Gmail", "E2E Gmail", "127.0.0.1", "9", "me@example.com");
  await expect(page.getByTestId("mail-status")).toContainText("Sending with E2E Gmail");
  await expect(row(page, "E2E Gmail")).toContainText("Active");
  expect(await page.content(), "the saved password must never be sent back to the browser").not.toContain(PASS);

  await page.getByLabel("Send the test email to").fill("someone@example.com");
  await page.getByRole("button", { name: "Send test email" }).click();
  await expect(page.getByText(/Could not connect to the server/)).toBeVisible();

  // 2. add a second one: it is only saved, not switched to
  await addConnection(page, "Outlook / Microsoft 365", "E2E Outlook", "127.0.0.2", "9", "no-reply@example.com", false);
  await expect(row(page, "E2E Outlook")).toContainText("Saved");
  await expect(row(page, "E2E Gmail")).toContainText("Active");

  // 3. a duplicate name is refused
  await fillConnection(page, "e2e gmail", "127.0.0.3", "9", "x@example.com");
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("A connection with that name already exists.")).toBeVisible();

  // 4. switch to the second connection
  await page.goto("/admin/settings?tab=email");
  await row(page, "E2E Outlook").getByRole("button", { name: "Use E2E Outlook" }).click();
  await expect(page.getByTestId("mail-status")).toContainText("Sending with E2E Outlook");
  await expect(row(page, "E2E Gmail")).toContainText("Saved");

  // 5. edit: the form says a password is saved, and leaving it blank keeps it
  await page.getByRole("link", { name: "Edit E2E Gmail" }).click();
  await expect(page.getByText('Edit "E2E Gmail"')).toBeVisible();
  await expect(page.getByText("A password is saved. Leave blank to keep it.")).toBeVisible();
  await expand(page, "Server settings");
  await page.getByLabel("Port").fill("10");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("mail-saved")).toBeVisible();
  await expect(row(page, "E2E Gmail")).toContainText("127.0.0.1:10");
  expect(await page.content()).not.toContain(PASS);

  // 6. delete both: back to "not configured"
  await row(page, "E2E Gmail").getByRole("button", { name: "Delete E2E Gmail" }).click();
  await expect(row(page, "E2E Gmail")).toHaveCount(0);
  await row(page, "E2E Outlook").getByRole("button", { name: "Delete E2E Outlook" }).click();
  await expect(page.getByTestId("mail-connection")).toHaveCount(0);
  await expect(page.getByTestId("mail-status")).toContainText("Email is not configured");
});
