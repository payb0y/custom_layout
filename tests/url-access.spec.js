const { test, expect } = require("@playwright/test");
const { login, clearHidden, setHidden, sidebarHrefs } = require("./helpers");

// Hiding is sidebar-only: an app the administrator hides vanishes from the
// navigation, but every route it serves — pages included — stays reachable for
// anyone who has (or types, or bookmarked) the URL.
//
// Files is the subject because it is a core app with both a page route and a
// plain, non-OCS JSON route:
//   /index.php/apps/files/               -> view#index          (TemplateResponse)
//   /index.php/apps/files/api/v1/stats   -> Api#getStorageStats (DataResponse)

const BASIC = "Basic " + Buffer.from("admin:admin").toString("base64");

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test("a hidden app page is still reachable by URL", async ({ page }) => {
  setHidden({ files: true });
  await login(page);

  const response = await page.goto("/index.php/apps/files/");
  expect(response.status()).toBe(200);
});

test("a hidden app is absent from the sidebar on its own page", async ({
  page,
}) => {
  // Both halves of the contract in one assertion pair: the entry is gone from
  // the navigation while the page it points at renders perfectly well.
  setHidden({ files: true });
  await login(page);

  await page.goto("/index.php/apps/files/");
  await expect(page.locator(".cl-sidebar")).toBeVisible();

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes("/apps/files/"))).toBe(false);
});

test("a hidden app keeps serving its plain JSON API", async ({ page }) => {
  // getStorageStats is an internal AJAX route, so it requires a CSRF token —
  // session cookie plus requesttoken, exactly how the app's own frontend calls
  // it. The WebDAV test below covers the external-integration case instead.
  setHidden({ files: true });
  await login(page);

  const token = await page.evaluate(() => window.OC && window.OC.requestToken);
  expect(token).toBeTruthy();

  const api = await page.request.get("/index.php/apps/files/api/v1/stats", {
    headers: { requesttoken: token },
  });
  expect(api.status()).toBe(200);
});

test("a hidden app keeps serving WebDAV", async ({ request }) => {
  setHidden({ files: true });

  const dav = await request.fetch("/remote.php/dav/files/admin/", {
    method: "PROPFIND",
    headers: { Authorization: BASIC, Depth: "0" },
  });
  expect(dav.status()).toBe(207);
});

test("a visible app page still renders", async ({ page }) => {
  setHidden({ files: true });
  await login(page);

  const response = await page.goto("/index.php/apps/dashboard/");
  expect(response.status()).toBe(200);
});
