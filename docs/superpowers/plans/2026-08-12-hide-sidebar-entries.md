# Hide Sidebar Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a superadmin hide apps from the Custom Layout sidebar, with hidden apps' pages returning 403 while their APIs keep serving.

**Architecture:** A Nextcloud declarative settings form writes a JSON object of hidden app ids to appconfig. One small service owns that key. A render listener pushes the list into the page as initial state for `layout.js` to filter on, and a globally-registered middleware swaps any `TemplateResponse` for a hidden app with a 403 — leaving JSON, OCS and DAV responses untouched.

**Tech Stack:** PHP 8.0+, Nextcloud 29–34 server APIs, vanilla ES5-style JS (no bundler), Playwright for verification.

**Spec:** `docs/superpowers/specs/2026-08-12-hide-sidebar-entries-design.md`

## Global Constraints

- **No build step.** No bundler, no linter, no composer, no PHP test framework. Ship raw PHP/JS/CSS.
- **No `innerHTML` on attacker-reachable paths.** Use `createElement` / `setAttribute` / `cloneNode` (CLAUDE.md).
- **NC compatibility is declared in three places that must agree:** `appinfo/info.xml` `<nextcloud min-version max-version>`, and the comment headers atop `js/layout.js` and `css/layout.css`. This work moves the floor to **29** (declarative settings is `@since 29.0.0`); ceiling stays **34**.
- **Reload after PHP/info.xml edits:** `occ app:disable custom_layout && occ app:enable custom_layout`. JS/CSS edits need only a browser reload.
- **Test harness deps stay local.** `package.json` and `node_modules/` are gitignored by design — do not commit them. Test *source* (`playwright.config.js`, `tests/*.js`) is committed.

### Environment (verified 2026-08-12)

| | |
|---|---|
| Base URL | `http://nextcloud.local:8080` |
| Credentials | `admin` / `admin` |
| URLs use an `index.php` prefix | e.g. `/index.php/apps/dashboard/` |
| occ prefix | `docker exec -u www-data master-nextcloud-1 php occ` |
| App path in container | `/var/www/html/apps-shared/custom_layout` |
| Server source (for reference) | `/home/payboy/src/nextcloud-docker-dev/workspace/server` |
| NC version | 34.0.0 dev |

### The seven navigation entries on this instance

`INavigationManager::getAll(TYPE_APPS)` yields these. **Names come from the navigation entry, not the app's `info.xml` `<name>`** — two differ:

| App id | Shown as |
|---|---|
| `dashboard` | Dashboard |
| `employee_dashboard` | My Dashboard |
| `adminpage` | Admin Page |
| `superadminpage` | Super Admin |
| `projectcreatoraio` | Projects |
| `organization` | Organizations |
| `files` | Files |

`projectcreatoraio` is the test subject throughout: it declares **no OCS routes**, so its API is plain `Controller` routes through `index.php` — exactly the case the block rule must not break.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `lib/HiddenApps.php` | Sole owner of the `hidden_apps` config key and its JSON shape. |
| `lib/Settings/AdminSection.php` | The Settings → Administration entry. |
| `lib/Settings/HiddenAppsForm.php` | The declarative schema; enumerates apps. |
| `lib/Middleware/HiddenAppMiddleware.php` | Blocks hidden apps' page renders. |
| `img/app-dark.svg` | Section icon. No `img/` directory exists yet. |
| `playwright.config.js` | Test runner config. |
| `tests/helpers.js` | Login + occ helpers shared by specs. |
| `tests/sidebar.spec.js` | Sidebar filtering behaviour. |
| `tests/settings.spec.js` | The settings form. |
| `tests/enforcement.spec.js` | 403 on pages, 200 on APIs. |

**Modify:**

| File | Change |
|---|---|
| `lib/AppInfo/Application.php` | Register the declarative form and the global middleware. |
| `lib/Listener/BeforeTemplateRenderedListener.php` | Provide lazy initial state. |
| `js/layout.js` | Read initial state; filter links in `rebuildSidebar()`; header comment. |
| `appinfo/info.xml` | `<settings>` block; `min-version` 25 → 29; app version 1.0.0 → 1.1.0. |
| `css/layout.css` | Header comment only. |

---

## Task 1: Test harness and baseline

Establishes the red/green cycle every later task depends on. Playwright is installed but has no config — there is nothing to run today.

**Files:**
- Create: `playwright.config.js`
- Create: `tests/helpers.js`
- Create: `tests/sidebar.spec.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `login(page)`, `occ(args): string`, `setHidden(objectMap): void`, `clearHidden(): void` from `tests/helpers.js`.

- [ ] **Step 1: Create the Playwright config**

`workers: 1` is mandatory — these tests mutate instance-wide appconfig and would race each other.

```javascript
// playwright.config.js
module.exports = {
  testDir: './tests',
  timeout: 30000,
  workers: 1, // tests mutate instance-wide appconfig; never run them in parallel
  reporter: 'list',
  use: {
    baseURL: 'http://nextcloud.local:8080',
    headless: true,
    ignoreHTTPSErrors: true,
  },
};
```

- [ ] **Step 2: Create the shared helpers**

```javascript
// tests/helpers.js
const { execSync } = require('child_process');

const OCC = 'docker exec -u www-data master-nextcloud-1 php occ';

/** Run an occ subcommand and return its stdout. */
function occ(args) {
  return execSync(`${OCC} ${args}`, { encoding: 'utf8' });
}

/** Write the hidden-apps map, e.g. setHidden({ projectcreatoraio: true }). */
function setHidden(map) {
  occ(`config:app:set custom_layout hidden_apps --value='${JSON.stringify(map)}'`);
}

/** Remove the key entirely. Safe to call when it is already absent. */
function clearHidden() {
  try {
    occ('config:app:delete custom_layout hidden_apps');
  } catch (e) {
    // Key was not set — that is the state we wanted anyway.
  }
}

/** Log in as admin. Verified selectors: #user, #password, button[type=submit]. */
async function login(page) {
  await page.goto('/index.php/login');
  await page.fill('#user', 'admin');
  await page.fill('#password', 'admin');
  await Promise.all([
    page.waitForURL('**/apps/dashboard/**'),
    page.click('button[type="submit"]'),
  ]);
}

/** hrefs of every rendered sidebar item. */
async function sidebarHrefs(page) {
  return page.locator('.cl-item').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')),
  );
}

module.exports = { occ, setHidden, clearHidden, login, sidebarHrefs };
```

- [ ] **Step 3: Write the baseline characterization test**

This one is expected to **pass** immediately — it pins down current behaviour so later tasks can prove they changed it deliberately.

```javascript
// tests/sidebar.spec.js
const { test, expect } = require('@playwright/test');
const { login, clearHidden, sidebarHrefs } = require('./helpers');

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test('baseline: sidebar lists every navigation app', async ({ page }) => {
  await login(page);
  await page.goto('/index.php/apps/dashboard/');

  await expect(page.locator('.cl-sidebar')).toBeVisible();

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes('/apps/projectcreatoraio/'))).toBe(true);
  expect(hrefs.some((h) => h && h.includes('/apps/files/'))).toBe(true);
});
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx playwright test tests/sidebar.spec.js
```

Expected: `1 passed`. If Chromium is missing, run `npx playwright install chromium` first.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.js tests/
git commit -m "test: add Playwright harness and sidebar baseline"
```

---

## Task 2: Hidden-apps service, initial state, and sidebar filtering

A complete vertical slice: setting the config by hand makes an app vanish from the sidebar. The settings UI comes later and is not needed here.

**Files:**
- Create: `lib/HiddenApps.php`
- Modify: `lib/Listener/BeforeTemplateRenderedListener.php`
- Modify: `js/layout.js`
- Test: `tests/sidebar.spec.js`

**Interfaces:**
- Consumes: `setHidden`, `clearHidden`, `login`, `sidebarHrefs` from `tests/helpers.js`.
- Produces: `OCA\CustomLayout\HiddenApps` with `public const CONFIG_KEY = 'hidden_apps'` and `public function getHiddenAppIds(): array` returning `list<string>`. Task 4 depends on both.

- [ ] **Step 1: Write the failing test**

Append to `tests/sidebar.spec.js`:

```javascript
test('a hidden app disappears from the sidebar', async ({ page }) => {
  setHidden({ projectcreatoraio: true });

  await login(page);
  await page.goto('/index.php/apps/dashboard/');

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes('/apps/projectcreatoraio/'))).toBe(false);
  // Everything else is untouched.
  expect(hrefs.some((h) => h && h.includes('/apps/files/'))).toBe(true);
});

test('a malformed config value hides nothing', async ({ page }) => {
  // Fail open: a corrupt value must never blank the sidebar for everyone.
  occ(`config:app:set custom_layout hidden_apps --value='not json at all'`);

  await login(page);
  await page.goto('/index.php/apps/dashboard/');

  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes('/apps/projectcreatoraio/'))).toBe(true);
});
```

Update the import line at the top of the file to pull in the extra helpers:

```javascript
const { login, clearHidden, setHidden, occ, sidebarHrefs } = require('./helpers');
```

- [ ] **Step 2: Run and confirm it fails**

```bash
npx playwright test tests/sidebar.spec.js
```

Expected: `1 passed, 2 failed` — "a hidden app disappears" fails because `projectcreatoraio` is still listed. ("a malformed config value hides nothing" passes trivially for now, since nothing hides anything yet; it becomes meaningful once filtering exists.)

- [ ] **Step 3: Create the config-key service**

```php
<?php

declare(strict_types=1);

namespace OCA\CustomLayout;

use OCA\CustomLayout\AppInfo\Application;
use OCP\IAppConfig;

/**
 * Sole owner of the `hidden_apps` config key.
 *
 * Nextcloud's declarative settings persists the multi-checkbox field through
 * IAppConfig::setValueString() (DeclarativeManager.php:343), so the row is typed
 * VALUE_STRING holding a JSON object like {"deck":true,"files":false}. Reading it
 * back with getValueArray() performs a VALUE_ARRAY typed read (AppConfig.php:446)
 * and throws AppConfigTypeConflictException on the mismatch — so we read the
 * string and decode by hand, and nothing else touches this key.
 */
class HiddenApps {
	public const CONFIG_KEY = 'hidden_apps';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	/**
	 * App ids the administrator has hidden.
	 *
	 * Fails open: absent, malformed, or unexpected JSON yields an empty list,
	 * because a corrupt config value must never 403 every app at once.
	 *
	 * @return list<string>
	 */
	public function getHiddenAppIds(): array {
		$raw = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY, '{}');

		$decoded = json_decode($raw, true);
		if (!is_array($decoded)) {
			return [];
		}

		$hidden = [];
		foreach ($decoded as $appId => $isHidden) {
			if ($isHidden) {
				$hidden[] = (string)$appId;
			}
		}

		return $hidden;
	}
}
```

- [ ] **Step 4: Push the list into the page as initial state**

Replace `lib/Listener/BeforeTemplateRenderedListener.php` entirely:

```php
<?php

declare(strict_types=1);

namespace OCA\CustomLayout\Listener;

use OCA\CustomLayout\AppInfo\Application;
use OCA\CustomLayout\HiddenApps;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * @implements IEventListener<BeforeTemplateRenderedEvent>
 */
class BeforeTemplateRenderedListener implements IEventListener {
	public function __construct(
		private IInitialState $initialState,
		private HiddenApps $hiddenApps,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent) {
			return;
		}

		// Lazy on purpose: this listener runs on every render, and the docblock
		// for provideLazyInitialState names exactly this case — an app injected
		// into pages that should not load state on e.g. webdav requests.
		$this->initialState->provideLazyInitialState(
			HiddenApps::CONFIG_KEY,
			fn (): array => $this->hiddenApps->getHiddenAppIds(),
		);

		Util::addStyle(Application::APP_ID, 'layout');
		Util::addScript(Application::APP_ID, 'layout');
	}
}
```

- [ ] **Step 5: Read and apply the list in `js/layout.js`**

Add this after the `findAppLinksFromInitialState()` function (around line 163):

```javascript
  /**
   * App ids the administrator has hidden, from our own initial state.
   * Read once at start() — the value cannot change without a page reload.
   */
  let hiddenAppIds = [];

  function readHiddenApps() {
    const el = document.getElementById(
      "initial-state-custom_layout-hidden_apps",
    );
    if (!el || !el.value) return [];
    try {
      const parsed = JSON.parse(atob(el.value));
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (e) {
      return [];
    }
  }
```

In `rebuildSidebar()`, replace these two lines:

```javascript
    const links = findAppLinksFromInitialState() || findAppLinks();
    if (links.length === 0) return false;
```

with:

```javascript
    const allLinks = findAppLinksFromInitialState() || findAppLinks();
    // An empty *unfiltered* list means Nextcloud's menu is not ready yet; an
    // empty filtered list is a legitimate all-hidden sidebar, so the bail-out
    // has to test the unfiltered one.
    if (allLinks.length === 0) return false;

    const links = hiddenAppIds.length
      ? allLinks.filter((l) => hiddenAppIds.indexOf(getAppId(l)) === -1)
      : allLinks;
```

In `start()`, read the list before the first build:

```javascript
  function start() {
    loadStateFromStorage();
    hiddenAppIds = readHiddenApps();
    rebuildSidebar();
```

- [ ] **Step 6: Reload the app**

PHP changed, so the app must be re-registered:

```bash
docker exec -u www-data master-nextcloud-1 php occ app:disable custom_layout
docker exec -u www-data master-nextcloud-1 php occ app:enable custom_layout
```

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npx playwright test tests/sidebar.spec.js
```

Expected: `3 passed`.

- [ ] **Step 8: Commit**

```bash
git add lib/HiddenApps.php lib/Listener/BeforeTemplateRenderedListener.php js/layout.js tests/sidebar.spec.js
git commit -m "feat: filter hidden apps out of the sidebar"
```

---

## Task 3: Settings section and declarative form

**Files:**
- Create: `img/app-dark.svg`
- Create: `lib/Settings/AdminSection.php`
- Create: `lib/Settings/HiddenAppsForm.php`
- Modify: `lib/AppInfo/Application.php`
- Modify: `appinfo/info.xml`
- Modify: `js/layout.js:1-13` (header comment), `css/layout.css` (header comment)
- Test: `tests/settings.spec.js`

**Interfaces:**
- Consumes: `HiddenApps::CONFIG_KEY` from Task 2.
- Produces: an admin settings page at `/index.php/settings/admin/custom_layout`; checkbox ids follow `hidden_apps_field_<appId>` (`DeclarativeSection.vue:90` builds them as `formField.id + '_field_' + option.value`).

- [ ] **Step 1: Write the failing tests**

The second test is the important one. `occ config:app:set` writes `VALUE_MIXED`, which reads back fine under *any* typed read — so an occ-only test would never catch a `getValueString`/`getValueArray` mismatch. Only a real form save writes `VALUE_STRING`.

```javascript
// tests/settings.spec.js
const { test, expect } = require('@playwright/test');
const { login, clearHidden, occ, sidebarHrefs } = require('./helpers');

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test('the form lists every navigation app by its display name', async ({ page }) => {
  await login(page);
  await page.goto('/index.php/settings/admin/custom_layout');

  await expect(page.getByText('Sidebar visibility')).toBeVisible();

  // Display names, not slugs — this is what MULTI_CHECKBOX buys over MULTI_SELECT.
  await expect(page.getByText('Projects', { exact: true })).toBeVisible();
  await expect(page.getByText('My Dashboard', { exact: true })).toBeVisible();

  await expect(page.locator('#hidden_apps_field_projectcreatoraio')).toBeAttached();
});

test('a value saved by the form is readable by the sidebar filter', async ({ page }) => {
  // Guards the VALUE_STRING vs VALUE_ARRAY type conflict. occ writes VALUE_MIXED,
  // which any typed read accepts; only the form writes VALUE_STRING. If
  // HiddenApps ever switches to getValueArray(), this is the test that fails.
  await login(page);
  await page.goto('/index.php/settings/admin/custom_layout');

  await page.locator('#hidden_apps_field_projectcreatoraio').check();
  await expect
    .poll(() => occ('config:app:get custom_layout hidden_apps'), { timeout: 10000 })
    .toContain('"projectcreatoraio":true');

  await page.goto('/index.php/apps/dashboard/');
  const hrefs = await sidebarHrefs(page);
  expect(hrefs.some((h) => h && h.includes('/apps/projectcreatoraio/'))).toBe(false);
});
```

- [ ] **Step 2: Run and confirm they fail**

```bash
npx playwright test tests/settings.spec.js
```

Expected: `2 failed` — the settings URL 404s, because no section is registered yet.

- [ ] **Step 3: Create the section icon**

`img/app-dark.svg` — the app has no `img/` directory, so create it. A framed rectangle with a left rail, which is what the app does:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
	<path d="M2.75 2.75h10.5v10.5H2.75z" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>
	<path d="M6.25 2.75v10.5" fill="none" stroke="#000" stroke-width="1.5"/>
</svg>
```

- [ ] **Step 4: Create the settings section**

```php
<?php

declare(strict_types=1);

namespace OCA\CustomLayout\Settings;

use OCA\CustomLayout\AppInfo\Application;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class AdminSection implements IIconSection {
	public function __construct(
		private IL10N $l,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l->t('Custom Layout');
	}

	public function getPriority(): int {
		return 75;
	}

	public function getIcon(): string {
		return $this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg');
	}
}
```

- [ ] **Step 5: Create the declarative form**

```php
<?php

declare(strict_types=1);

namespace OCA\CustomLayout\Settings;

use OCA\CustomLayout\AppInfo\Application;
use OCA\CustomLayout\HiddenApps;
use OCP\IL10N;
use OCP\INavigationManager;
use OCP\Settings\DeclarativeSettingsTypes;
use OCP\Settings\IDeclarativeSettingsForm;

class HiddenAppsForm implements IDeclarativeSettingsForm {
	public function __construct(
		private IL10N $l,
		private INavigationManager $navigationManager,
	) {
	}

	public function getSchema(): array {
		$options = $this->appOptions();

		return [
			// Unprefixed on purpose. DeclarativeSection.vue posts
			// form.id.replace(app + '_', ''), while DeclarativeManager::getForm()
			// (DeclarativeManager.php:282) matches the schema id exactly. An
			// unprefixed id makes that strip a no-op so the two agree.
			'id' => 'visibility',
			'priority' => 10,
			'section_type' => DeclarativeSettingsTypes::SECTION_TYPE_ADMIN,
			'section_id' => Application::APP_ID,
			'storage_type' => DeclarativeSettingsTypes::STORAGE_TYPE_INTERNAL,
			'title' => $this->l->t('Sidebar visibility'),
			'description' => $this->l->t('Choose which apps appear in the Custom Layout sidebar. Hidden apps are removed from the sidebar for everyone and their pages return 403 — their APIs keep working.'),
			'fields' => [
				[
					'id' => HiddenApps::CONFIG_KEY,
					'title' => $this->l->t('Hidden apps'),
					'description' => $this->l->t('Applies to every user, including administrators. Takes effect on their next page load.'),
					// MULTI_CHECKBOX, not MULTI_SELECT: multi-select hands options
					// straight to NcSelect with no `label` prop, so {name, value}
					// entries never render their name (DeclarativeSection.vue:51).
					// Multi-checkbox reads option.name explicitly (line 86).
					'type' => DeclarativeSettingsTypes::MULTI_CHECKBOX,
					'options' => $options,
					'default' => $this->nothingHidden($options),
				],
			],
		];
	}

	/**
	 * Every app with a navigation entry, as {name, value} pairs.
	 *
	 * TYPE_APPS deliberately excludes TYPE_SETTINGS, so Settings can never be
	 * offered as a hideable target — which is what keeps the un-hide route
	 * reachable given there is no protected-app list.
	 *
	 * @return list<array{name: string, value: string}>
	 */
	private function appOptions(): array {
		$options = [];
		foreach ($this->navigationManager->getAll(INavigationManager::TYPE_APPS) as $entry) {
			if (!isset($entry['id'], $entry['name'])) {
				continue;
			}
			$options[] = [
				'name' => (string)$entry['name'],
				'value' => (string)$entry['id'],
			];
		}
		return $options;
	}

	/**
	 * Default state: every app visible.
	 *
	 * @param list<array{name: string, value: string}> $options
	 * @return array<string, bool>
	 */
	private function nothingHidden(array $options): array {
		$default = [];
		foreach ($options as $option) {
			$default[$option['value']] = false;
		}
		return $default;
	}
}
```

- [ ] **Step 6: Register the form**

In `lib/AppInfo/Application.php`, add the import and one call inside `register()`:

```php
use OCA\CustomLayout\Settings\HiddenAppsForm;
```

```php
	public function register(IRegistrationContext $context): void {
		// Inject our global stylesheet and script before each rendered template.
		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			BeforeTemplateRenderedListener::class
		);

		$context->registerDeclarativeSettings(HiddenAppsForm::class);
	}
```

- [ ] **Step 7: Register the section and move the version floor**

In `appinfo/info.xml`: bump `<version>` to `1.1.0`, change `min-version="25"` to `min-version="29"`, and add a `<settings>` block before `<dependencies>`. The section is registered here — `IRegistrationContext` has no equivalent method for it.

```xml
	<version>1.1.0</version>
```

```xml
	<settings>
		<admin-section>OCA\CustomLayout\Settings\AdminSection</admin-section>
	</settings>
	<dependencies>
		<php min-version="8.0"/>
		<nextcloud min-version="29" max-version="34"/>
	</dependencies>
```

- [ ] **Step 8: Update both compatibility headers**

CLAUDE.md requires these to agree with `info.xml`.

In `js/layout.js` line 2, change:

```javascript
 * Custom Layout — modern SaaS-style sidebar for Nextcloud 32.
```

to:

```javascript
 * Custom Layout — modern SaaS-style sidebar for Nextcloud 29–34.
```

Apply the same edit to the equivalent line in the `css/layout.css` header comment.

- [ ] **Step 9: Reload the app and run the tests**

```bash
docker exec -u www-data master-nextcloud-1 php occ app:disable custom_layout
docker exec -u www-data master-nextcloud-1 php occ app:enable custom_layout
npx playwright test tests/settings.spec.js
```

Expected: `2 passed`. If `app:enable` refuses on version grounds, re-check that `max-version` is still `34`.

- [ ] **Step 10: Confirm nothing regressed**

```bash
npx playwright test
```

Expected: `5 passed`.

- [ ] **Step 11: Commit**

```bash
git add img/ lib/Settings/ lib/AppInfo/Application.php appinfo/info.xml js/layout.js css/layout.css tests/settings.spec.js
git commit -m "feat: add admin settings form for hiding sidebar apps"
```

---

## Task 4: Block hidden apps' pages

**Files:**
- Create: `lib/Middleware/HiddenAppMiddleware.php`
- Modify: `lib/AppInfo/Application.php`
- Test: `tests/enforcement.spec.js`

**Interfaces:**
- Consumes: `OCA\CustomLayout\HiddenApps::getHiddenAppIds()` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/enforcement.spec.js
const { test, expect } = require('@playwright/test');
const { login, clearHidden, setHidden } = require('./helpers');

test.beforeEach(() => clearHidden());
test.afterAll(() => clearHidden());

test('a hidden app page is blocked', async ({ page }) => {
  setHidden({ projectcreatoraio: true });
  await login(page);

  const response = await page.goto('/index.php/apps/projectcreatoraio/');
  expect(response.status()).toBe(403);
  await expect(page.getByText('Access forbidden')).toBeVisible();
});

test('a hidden app keeps serving its plain JSON API', async ({ page }) => {
  // projectcreatoraio declares no OCS routes at all — this endpoint is a plain
  // Controller route through index.php, the same entry script as the blocked
  // page above. This is the assertion the whole design turns on.
  setHidden({ projectcreatoraio: true });
  await login(page);

  const api = await page.request.get(
    '/index.php/apps/projectcreatoraio/api/v1/users/admin/projects',
  );
  expect(api.status()).toBe(200);
});

test('a visible app page still renders', async ({ page }) => {
  setHidden({ projectcreatoraio: true });
  await login(page);

  const response = await page.goto('/index.php/apps/files/');
  expect(response.status()).toBe(200);
});
```

- [ ] **Step 2: Run and confirm the first one fails**

```bash
npx playwright test tests/enforcement.spec.js
```

Expected: `1 failed, 2 passed` — the hidden page still returns 200. The other two pass already and must keep passing.

- [ ] **Step 3: Create the middleware**

```php
<?php

declare(strict_types=1);

namespace OCA\CustomLayout\Middleware;

use OCA\CustomLayout\HiddenApps;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Middleware;
use OCP\IRequest;

/**
 * Blocks page renders for apps the administrator has hidden.
 *
 * Registered globally, so it sees requests bound for every app rather than only
 * custom_layout's own routes.
 *
 * Only TemplateResponse is blocked, because that is precisely "a rendered page".
 * Everything else passes: OCS, WebDAV, and — importantly — plain non-OCS JSON
 * routes under /apps/<slug>/api/, which travel through index.php alongside real
 * pages and which a path-based rule would take down with them.
 *
 * Trade-off: the controller has already run by the time afterController fires.
 * Harmless for GET page renders; a POST route returning a TemplateResponse would
 * complete its side effect before the 403. Accepted deliberately — see the spec.
 */
class HiddenAppMiddleware extends Middleware {
	public function __construct(
		private IRequest $request,
		private HiddenApps $hiddenApps,
	) {
	}

	public function afterController(Controller $controller, string $methodName, Response $response): Response {
		// StandaloneTemplateResponse extends TemplateResponse, so this also
		// covers login and public pages.
		if (!$response instanceof TemplateResponse) {
			return $response;
		}

		$appId = $this->appIdForPath($this->request->getPathInfo());
		if ($appId === null) {
			return $response;
		}

		if (!in_array($appId, $this->hiddenApps->getHiddenAppIds(), true)) {
			return $response;
		}

		$blocked = new TemplateResponse(
			'core',
			'403',
			['message' => $this->l->t('This app has been hidden by your administrator.')],
			TemplateResponse::RENDER_AS_GUEST,
		);
		$blocked->setStatus(Http::STATUS_FORBIDDEN);

		return $blocked;
	}

	/**
	 * The app slug a request path addresses, or null when it addresses none.
	 * getPathInfo() returns string|false, hence the type check.
	 */
	private function appIdForPath(mixed $pathInfo): ?string {
		if (!is_string($pathInfo)) {
			return null;
		}
		if (preg_match('#^/apps/([^/?\#]+)#', $pathInfo, $matches) !== 1) {
			return null;
		}
		return $matches[1];
	}
}
```

Add `IL10N` to the constructor for the `$this->l->t(...)` call above:

```php
use OCP\IL10N;
```

```php
	public function __construct(
		private IRequest $request,
		private HiddenApps $hiddenApps,
		private IL10N $l,
	) {
	}
```

- [ ] **Step 4: Register it globally**

In `lib/AppInfo/Application.php`, add the import:

```php
use OCA\CustomLayout\Middleware\HiddenAppMiddleware;
```

and the registration inside `register()`, after the declarative settings line:

```php
		// global: true — this must see requests bound for every app, not just
		// ours. The flag is @since NC 26 (IRegistrationContext.php:135) and
		// DIContainer.php:239-244 injects such middleware into every app's
		// dispatcher.
		$context->registerMiddleware(HiddenAppMiddleware::class, true);
```

- [ ] **Step 5: Reload the app and run the tests**

```bash
docker exec -u www-data master-nextcloud-1 php occ app:disable custom_layout
docker exec -u www-data master-nextcloud-1 php occ app:enable custom_layout
npx playwright test tests/enforcement.spec.js
```

Expected: `3 passed`.

- [ ] **Step 6: Run the whole suite**

```bash
npx playwright test
```

Expected: `8 passed`.

- [ ] **Step 7: Manually confirm the documented default-app trap**

The spec documents this rather than fixing it, so verify it behaves as written:

```bash
docker exec -u www-data master-nextcloud-1 php occ config:app:set custom_layout hidden_apps --value='{"dashboard":true}'
```

Log in through a fresh private window. Expect to land on a 403, since Dashboard is the default entry. Then recover and confirm recovery works:

```bash
docker exec -u www-data master-nextcloud-1 php occ config:app:delete custom_layout hidden_apps
```

- [ ] **Step 8: Commit**

```bash
git add lib/Middleware/ lib/AppInfo/Application.php tests/enforcement.spec.js
git commit -m "feat: block hidden apps' pages while leaving their APIs live"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: storage contract and fail-open → Task 2 Step 3; sidebar filtering and the unfiltered-empty subtlety → Task 2 Step 5; form schema, `MULTI_CHECKBOX`, unprefixed id, `TYPE_APPS` enumeration → Task 3 Steps 5–6; section registration and the version floor → Task 3 Step 7; compatibility headers → Task 3 Step 8; middleware, response-type rule, global registration → Task 4 Steps 3–4; the default-app trap → Task 4 Step 7; verification commands → distributed across every task's test steps.

**Deliberately not built:** unified search, Dashboard widgets, and Settings → Apps still surface hidden apps — out of scope per the spec.

**Known wart, not fixed here:** `package.json` is gitignored per CLAUDE.md, so a fresh clone gets the committed specs without the dependency that runs them. Re-add it with `npm i -D @playwright/test`. Fixing that properly means revisiting the repo's gitignore policy, which is outside this feature.

**Type consistency.** `HiddenApps::CONFIG_KEY` (`'hidden_apps'`) is used as the appconfig key, the initial-state key, and the field id — which is what makes the DOM id `initial-state-custom_layout-hidden_apps` and the checkbox ids `hidden_apps_field_<appId>` line up. `getHiddenAppIds(): list<string>` is consumed identically by the listener (Task 2) and the middleware (Task 4).

---

## Execution notes

Recorded after the plan was executed. Where this section and the tasks above
disagree, this section is what was actually built.

**The middleware takes no `IL10N`.** Task 4 called for injecting it. A *global*
middleware is constructed inside whichever app's container is handling the
request, so `IL10N` would have resolved to that app's translation domain rather
than ours — and this app ships no `l10n/` directory, so it bought nothing. The
403 message is a plain string.

**Test subject moved from `projectcreatoraio` to core `files`.** Both in-house
apps the plan named have pre-existing broken dependencies on this instance and
return 500 on every API route regardless of this feature:

- `projectcreatoraio` — `ProjectApiController` requires `OCA\Deck\Service\BoardService`; the Deck app is not installed.
- `adminpage` — `DashboardController` requires `OCA\Organization\Service\UserQuotaService`; that class does not exist.

Core `files` is a stricter subject anyway: `view#index` (`TemplateResponse`) and
`Api#getStorageStats` (`DataResponse`) live in the same app behind the same entry
script, so response type is the *only* difference between the blocked and the
allowed request.

**Calling that JSON route needs a CSRF token.** `Api#getStorageStats` is an
internal AJAX route, so it answers 412 to any cookie-bearing request without a
`requesttoken` header — including a Basic-auth call made through Playwright's
`page.request`, which shares the browser cookie jar. The test sends the session
plus `window.OC.requestToken`. The WebDAV test covers the cookie-less external
caller instead, via Basic auth on `remote.php`.

**`occ` helpers use `execFileSync` with an argument array**, not a shell string
as sketched in Task 1 — a JSON value interpolated into a single-quoted shell
string breaks on any embedded quote.

**The version bump needs an upgrade cycle.** Moving `<version>` to 1.1.0 put the
server into "requires upgrade" state mid-`app:enable`. `occ upgrade` settles it
(`needsDbUpgrade: false` afterwards).

**A fourth compatibility declaration existed.** Beyond `info.xml`'s
`<nextcloud>` element and the two comment headers CLAUDE.md names, the
user-visible `<description>` in `info.xml` also carried a version ("Compatible
with Nextcloud 32.x."). All four now read 29–34.

**Final state:** 9 Playwright tests passing; the default-app trap manually
confirmed to behave as the spec documents.
