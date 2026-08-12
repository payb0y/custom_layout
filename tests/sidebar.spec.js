const { test, expect } = require("@playwright/test");
const {
  login,
  clearHidden,
  setHidden,
  occ,
  sidebarHrefs,
} = require("./helpers");

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

test("a hidden app disappears from the sidebar", async ({ page }) => {
  setHidden({ projectcreatoraio: true });

  await login(page);
  await page.goto("/index.php/apps/dashboard/");

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes("/apps/projectcreatoraio/"))).toBe(
    false,
  );
  // Everything else is untouched.
  expect(hrefs.some((h) => h && h.includes("/apps/files/"))).toBe(true);
});

test("a malformed config value hides nothing", async ({ page }) => {
  // Fail open: a corrupt value must never blank the sidebar for everyone.
  occ(
    "config:app:set",
    "custom_layout",
    "hidden_apps",
    "--value",
    "not json at all",
  );

  await login(page);
  await page.goto("/index.php/apps/dashboard/");

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes("/apps/projectcreatoraio/"))).toBe(
    true,
  );
});
