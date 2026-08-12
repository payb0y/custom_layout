const { test, expect } = require("@playwright/test");
const { login, clearHidden, sidebarHrefs } = require("./helpers");

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test("baseline: sidebar lists every navigation app", async ({ page }) => {
  await login(page);
  await page.goto("/index.php/apps/dashboard/");

  await expect(page.locator(".cl-sidebar")).toBeVisible();

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes("/apps/projectcreatoraio/"))).toBe(
    true,
  );
  expect(hrefs.some((h) => h && h.includes("/apps/files/"))).toBe(true);
});
