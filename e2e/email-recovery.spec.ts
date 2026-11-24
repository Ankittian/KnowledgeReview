import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ADMIN = { username: "e2e-admin", password: "e2e-admin-password" };
const MAIL_FILE = path.join(process.cwd(), "test-results", "mail-outbox.jsonl");

/** The newest 6-digit code emailed to `to` (the app appends every mail to MAIL_CAPTURE_FILE when no SMTP is set). */
async function codeFor(to: string, after = 0): Promise<string> {
  let found = "";
  await expect
    .poll(
      () => {
        if (!fs.existsSync(MAIL_FILE)) return "";
        const mails = fs.readFileSync(MAIL_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; text: string });
        const mine = mails.filter((m) => m.to === to);
        if (mine.length <= after) return "";
        found = /\b(\d{6})\b/.exec(mine[mine.length - 1].text)?.[1] ?? "";
        return found;
      },
      { timeout: 20_000 },
    )
    .not.toBe("");
  return found;
}
const mailCount = (to: string) =>
  fs.existsSync(MAIL_FILE) ? fs.readFileSync(MAIL_FILE, "utf8").trim().split("\n").filter(Boolean).filter((l) => (JSON.parse(l) as { to: string }).to === to).length : 0;

/** First sign-in shows a welcome tour over the page; close it (it is remembered per user afterwards). */
async function dismissTour(page: Page) {
  try {
    await page.getByRole("button", { name: "Close walkthrough" }).click({ timeout: 3000 });
  } catch {
    /* already seen */
  }
}

/** Sign out and wait until it is done, so the next page load does not race the logout. */
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function login(page: Page, who: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(who);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("add email with a code → sign in with it → change password by code → forgot password → sign in with a code", async ({ page, browser }, info) => {
  const p = info.project.name;
  const username = `mail-${p}`;
  const email = `${username}@example.com`;
  const pw1 = "first-password-123";
  const pw2 = "second-password-456";
  const pw3 = "third-password-789";

  // account: sign up + admin approval
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(`Mail ${p}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(pw1);
  await page.getByLabel("Confirm password").fill(pw1);
  await page.getByRole("button", { name: "Request account" }).click();
  await expect(page).toHaveURL(/\/pending/);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.username, ADMIN.password);
  await expect(admin).toHaveURL(/\/(today|chat)/);
  await admin.goto("/admin/users");
  await dismissTour(admin);
  await admin.getByTestId("pending-user").filter({ hasText: username }).getByTestId("approve").click();
  await expect(admin.getByTestId("pending-user").filter({ hasText: username })).toHaveCount(0);

  // no email yet: signing in with an email is refused, and the banner asks for one
  await login(page, email, pw1);
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();
  await login(page, username, pw1);
  await expect(page).toHaveURL(/\/(today|chat)/);
  await expect(page.getByTestId("email-banner")).toBeVisible();

  // 1. add the email: a wrong code is refused, the right one saves it
  await page.goto("/account"); // old link redirects
  await expect(page).toHaveURL(/\/profile/);
  await dismissTour(page);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const code1 = await codeFor(email);
  await page.getByLabel(/6-digit code/).fill(code1 === "000000" ? "000001" : "000000");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByText("That code is not valid or has expired")).toBeVisible();
  await page.getByLabel(/6-digit code/).fill(code1);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByTestId("email-verified")).toBeVisible();

  // 2. sign in with the email
  await signOut(page);
  await login(page, email.toUpperCase(), pw1);
  await expect(page).toHaveURL(/\/(today|chat)/);
  await expect(page.getByTestId("email-banner")).toHaveCount(0);

  // 3. change the password with an emailed code (old password not needed)
  await page.goto("/profile");
  await page.getByRole("tab", { name: "Use email code" }).click();
  await page.getByTestId("send-password-code").click();
  const code2 = await codeFor(email, 1);
  await page.getByLabel(/6-digit code/).fill(code2);
  await page.getByLabel("New password", { exact: true }).fill(pw2);
  await page.getByLabel("Confirm new password").fill(pw2);
  await page.getByTestId("password-otp-form").getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
  await signOut(page);
  await login(page, username, pw1);
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();
  await login(page, username, pw2);
  await expect(page).toHaveURL(/\/(today|chat)/);
  await signOut(page);

  // 4. forgot password (signed out): an unknown account is refused plainly and nothing is emailed for it
  const before = mailCount("nobody@example.com");
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Username or email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("No account found with that username or email.")).toBeVisible();
  expect(mailCount("nobody@example.com")).toBe(before);

  await page.goto("/forgot-password");
  await page.getByLabel("Username or email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("We sent a 6-digit code to")).toBeVisible();
  const code3 = await codeFor(email, 2);
  await page.getByLabel(/6-digit code/).fill(code3);
  await page.getByLabel("New password", { exact: true }).fill(pw3);
  await page.getByLabel("Confirm new password").fill(pw3);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
  await login(page, username, pw2);
  await expect(page.getByText("Incorrect username or password.")).toBeVisible();
  await login(page, username, pw3);
  await expect(page).toHaveURL(/\/(today|chat)/);

  // 4b. sign in with an emailed code instead of a password (a wrong code is refused first)
  await signOut(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "Use an email code instead" }).click();
  await page.getByLabel("Username or email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code to")).toBeVisible();
  const code4 = await codeFor(email, 3);
  await page.getByLabel("6-digit code").fill(code4 === "000000" ? "000001" : "000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That code is not valid or has expired")).toBeVisible();
  await page.getByLabel("6-digit code").fill(code4);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(today|chat)/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // 5. admin fallback: a temporary password signs the user out and works once set
  await admin.goto("/admin/users");
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("row").filter({ hasText: username }).getByRole("button", { name: /Reset password/ }).click();
  const temp = (await admin.getByTestId("temp-password").textContent())?.trim() ?? "";
  expect(temp.length).toBeGreaterThanOrEqual(12);
  const fresh = await (await browser.newContext()).newPage(); // the old access token lives out its 15 minutes; a new sign-in uses the new password
  await login(fresh, username, pw3);
  await expect(fresh.getByText("Incorrect username or password.")).toBeVisible();
  await login(fresh, username, temp);
  await expect(fresh).toHaveURL(/\/(today|chat)/);
  await adminCtx.close();
});
