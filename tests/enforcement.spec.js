const { test, expect } = require("@playwright/test");
const { login, clearHidden, setHidden } = require("./helpers");

// Files is the subject because it is a core app (so it has no broken
// dependencies) that exposes a page route and a plain, non-OCS JSON route in
// the same app:
//   /index.php/apps/files/               -> view#index          (TemplateResponse)
//   /index.php/apps/files/api/v1/stats   -> Api#getStorageStats (DataResponse)
// Both travel through index.php, so the only thing separating them is the
// response type — exactly the distinction the middleware turns on.

const BASIC = "Basic " + Buffer.from("admin:admin").toString("base64");

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test("a hidden app page is blocked", async ({ page }) => {
  setHidden({ files: true });
  await login(page);

  const response = await page.goto("/index.php/apps/files/");
  expect(response.status()).toBe(403);
  await expect(page.getByText("Access forbidden")).toBeVisible();
});

test("a hidden app keeps serving its plain JSON API", async ({ page }) => {
  // Same app and same entry script as the blocked page above. This is the
  // assertion the whole design turns on.
  //
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
  // Different entry script (remote.php), so the middleware never sees it.
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
