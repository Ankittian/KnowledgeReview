import { test, type Page } from "@playwright/test";

// Visual check: key screens in light and dark, at the project's viewport. Output: test-results/screens/*.png
const ADMIN = { username: "e2e-admin", password: "e2e-admin-password" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/today/);
}

for (const scheme of ["light", "dark"] as const) {
  test(`screens (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    const shot = (name: string) => page.screenshot({ path: `test-results/screens/${info.project.name}-${scheme}-${name}.png`, fullPage: true });
    await page.goto("/login");
    await shot("login");
    await login(page);
    await page.waitForTimeout(400);
    await shot("today-front");
    const done = await page.getByTestId("deck-complete").count();
    if (!done) {
      await page.getByTestId("reveal").click();
      await page.waitForTimeout(700);
      await page.getByTestId("knew-yes").click();
      await page.waitForTimeout(300);
      await shot("today-back");
      await page.getByTestId("verdict-improve").click();
      await page.waitForTimeout(500);
      await shot("today-feedback");
      await page.keyboard.press("Escape");
    }
    for (const p of ["progress", "browse", "admin/health", "admin/health?view=forms", "admin/feedback", "admin/team", "admin/users", "admin/settings"]) {
      await page.goto(`/${p}`);
      await page.waitForTimeout(250);
      await shot(p.replace(/[/?=]/g, "_"));
    }
  });
}
