const { execFileSync } = require("child_process");

const CONTAINER = "master-nextcloud-1";

/**
 * Run an occ subcommand and return its stdout.
 *
 * Arguments are passed as an array rather than interpolated into a shell
 * string, so JSON values containing quotes or spaces survive intact.
 *
 * @param {...string} args e.g. occ("config:app:get", "custom_layout", "hidden_apps")
 */
function occ(...args) {
  return execFileSync(
    "docker",
    ["exec", "-u", "www-data", CONTAINER, "php", "occ", ...args],
    { encoding: "utf8" },
  );
}

/** Write the hidden-apps map, e.g. setHidden({ projectcreatoraio: true }). */
function setHidden(map) {
  occ(
    "config:app:set",
    "custom_layout",
    "hidden_apps",
    "--value",
    JSON.stringify(map),
  );
}

/** Remove the key entirely. Safe to call when it is already absent. */
function clearHidden() {
  try {
    occ("config:app:delete", "custom_layout", "hidden_apps");
  } catch (e) {
    // Key was not set — that is the state we wanted anyway.
  }
}

/** Log in as admin. Verified selectors: #user, #password, button[type=submit]. */
async function login(page) {
  await page.goto("/index.php/login");
  await page.fill("#user", "admin");
  await page.fill("#password", "admin");
  await Promise.all([
    page.waitForURL("**/apps/dashboard/**"),
    page.click('button[type="submit"]'),
  ]);
}

/** hrefs of every rendered sidebar item. */
async function sidebarHrefs(page) {
  return page
    .locator(".cl-item")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
}

module.exports = { occ, setHidden, clearHidden, login, sidebarHrefs };
