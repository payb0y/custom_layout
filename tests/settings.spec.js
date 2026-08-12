const { test, expect } = require("@playwright/test");
const { login, clearHidden, occ, sidebarHrefs } = require("./helpers");

// NcCheckboxRadioSwitch renders the real <input> visually hidden behind a
// styled label that intercepts pointer events, so tests click the label and
// assert on the input's state rather than clicking the input directly.
const label = (appId) => `#hidden_apps_field_${appId}-label`;
const input = (appId) => `#hidden_apps_field_${appId}`;

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test("the form lists every navigation app by its display name", async ({
  page,
}) => {
  await login(page);
  await page.goto("/index.php/settings/admin/custom_layout");

  await expect(page.getByText("Sidebar visibility")).toBeVisible();

  // Display names, not slugs — this is what MULTI_CHECKBOX buys over
  // MULTI_SELECT, which would have listed "projectcreatoraio" here.
  await expect(page.locator(label("projectcreatoraio"))).toHaveText("Projects");
  await expect(page.locator(label("employee_dashboard"))).toHaveText(
    "My Dashboard",
  );

  // Settings is never offered, because TYPE_APPS excludes TYPE_SETTINGS.
  await expect(page.locator(input("settings"))).toHaveCount(0);
});

test("a value saved by the form is readable by the sidebar filter", async ({
  page,
}) => {
  // Guards the VALUE_STRING vs VALUE_ARRAY type conflict. occ writes
  // VALUE_MIXED, which any typed read accepts; only the form writes
  // VALUE_STRING. If HiddenApps ever switches to getValueArray(), this is the
  // test that fails.
  await login(page);
  await page.goto("/index.php/settings/admin/custom_layout");

  await page.locator(label("projectcreatoraio")).click();
  await expect(page.locator(input("projectcreatoraio"))).toBeChecked();

  await expect
    .poll(
      () => {
        // occ exits non-zero while the key is still unset; swallow that so the
        // poll retries rather than erroring out on the first tick.
        try {
          return occ("config:app:get", "custom_layout", "hidden_apps");
        } catch (e) {
          return "";
        }
      },
      { timeout: 10000 },
    )
    .toContain('"projectcreatoraio":true');

  await page.goto("/index.php/apps/dashboard/");
  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes("/apps/projectcreatoraio/"))).toBe(
    false,
  );
});
