# Hiding apps from the Custom Layout sidebar

**Status:** approved, ready for implementation planning
**Date:** 2026-08-12
**App:** `custom_layout` (`OCA\CustomLayout`)

## Problem

There is no way to remove an app from the Custom Layout sidebar. The sidebar is
built client-side from Nextcloud's complete app list, so every app with a
navigation entry appears, for every user, always.

A superadmin needs to hide chosen apps — and hiding must be real, not cosmetic:
a hidden app's page must be unreachable. Its APIs must keep working, because
external callers and other apps depend on them independently of whether a human
can open the app's page.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Instance-wide | One config value, no per-user or per-group resolution at render time. |
| Depth | Page blocked, APIs live | The explicit requirement. Enforced server-side, not by hiding UI. |
| Admin bypass | None | What the admin sees is what everyone sees. |
| Protected apps | None | Recoverable: the settings page is not under `/apps/`, so it can never be hidden. |
| Settings UI | Declarative settings form | Nextcloud renders, validates, and persists it. No JS, controller, template, or routes of ours. |
| Block rule | Response type, in `afterController` | Exactly identifies "a rendered page", so no API shape is over-blocked. |
| Blocked response | 403 with explanation | Debuggable. Hiding is instance-wide, so confirming the app exists leaks nothing. |

### Why declarative settings

This repo ships raw PHP, JS and CSS with no bundler, linter, or test harness.
A hand-written settings form means owning a save round-trip — request token,
error states, partial saves — that nothing in the project can verify. The
declarative schema hands that entire layer to Nextcloud.

Cost: declarative settings is `@since 29.0.0`, so `info.xml` `min-version` moves
`25` → `29`. The window narrows to 29–34 with nothing currently on the far side
of it; the instance runs 34 and `max-version` is already 34.

## Architecture

```
Admin ticks a box
  └─> POST /ocs/v2.php/settings/api/declarative/value      (Nextcloud's own endpoint)
        └─> appconfig  custom_layout / hidden_apps         (JSON object, VALUE_STRING)

Page render (any app)
  └─> BeforeTemplateRenderedListener
        └─> HiddenApps::getHiddenAppIds()
              └─> provideLazyInitialState('hidden_apps', …)
                    └─> layout.js filters the sidebar

Request to a hidden app's page
  └─> HiddenAppMiddleware::afterController()
        └─> TemplateResponse swapped for 403
            (JSON / OCS / DAV responses pass through untouched)
```

### New files

| File | Responsibility |
|---|---|
| `lib/HiddenApps.php` | Sole owner of the config key. `getHiddenAppIds(): string[]`. |
| `lib/Settings/HiddenAppsForm.php` | `IDeclarativeSettingsForm` — the schema. |
| `lib/Settings/AdminSection.php` | `IIconSection` — the Settings → Administration entry. |
| `lib/Middleware/HiddenAppMiddleware.php` | Blocks hidden apps' page renders. |
| `img/app-dark.svg` | Section icon. The app ships no `img/` directory today. |

### Modified files

| File | Change |
|---|---|
| `lib/AppInfo/Application.php` | `registerDeclarativeSettings()`, `registerMiddleware(…, global: true)`. |
| `lib/Listener/BeforeTemplateRenderedListener.php` | `provideLazyInitialState('hidden_apps', …)`. |
| `js/layout.js` | Read the initial state, filter links in `rebuildSidebar()`. |
| `appinfo/info.xml` | `<settings>` section registration; `min-version` 25 → 29; app version bump. |
| `js/layout.js`, `css/layout.css` | Compatibility comment headers, per CLAUDE.md's rule that they agree with `info.xml`. |
| `.gitignore` | `!docs/**/*.md`, so specs are trackable despite the blanket `*.md` rule. |

## Components

### `HiddenApps`

One method, `getHiddenAppIds(): array`, returning a list of app id strings.

**The storage contract is the whole reason this class exists.** Declarative
settings persists through `setValueString($app, $fieldId, $value)`
(`DeclarativeManager.php:343`), so the appconfig row is typed `VALUE_STRING`
holding JSON. Reading it back with `IAppConfig::getValueArray()` performs a
typed read against `VALUE_ARRAY` (`AppConfig.php:446-460`) and throws
`AppConfigTypeConflictException` on the mismatch.

The read path is therefore:

```php
$raw = $this->appConfig->getValueString('custom_layout', 'hidden_apps', '{}');
$decoded = json_decode($raw, true);
if (!is_array($decoded)) {
    return [];
}
// Stored shape is a JSON object: {"adminpage": true, "files": false}
return array_values(array_keys(array_filter($decoded)));
```

Fail open, always: absent, malformed, or non-array JSON yields `[]`. A corrupt
config value must never 403 every app at once. The method must not throw.

### `HiddenAppsForm`

```php
[
    'id'           => 'visibility',
    'priority'     => 10,
    'section_type' => DeclarativeSettingsTypes::SECTION_TYPE_ADMIN,
    'section_id'   => 'custom_layout',
    'storage_type' => DeclarativeSettingsTypes::STORAGE_TYPE_INTERNAL,
    'title'        => 'Sidebar visibility',
    'description'  => 'Choose which apps appear in the Custom Layout sidebar. '
                    . 'Hidden apps are removed from the sidebar for everyone and '
                    . 'their pages return 403 — their APIs keep working.',
    'fields' => [
        [
            'id'          => 'hidden_apps',
            'title'       => 'Hidden apps',
            'description' => 'Applies to every user, including administrators. '
                           . 'Takes effect on their next page load.',
            'type'        => DeclarativeSettingsTypes::MULTI_CHECKBOX,
            'options'     => $this->appOptions(),   // built at request time
            'default'     => $this->allFalse(),     // every app unchecked
        ],
    ],
]
```

`appOptions()` maps `INavigationManager::getAll(INavigationManager::TYPE_APPS)`
to `['name' => $entry['name'], 'value' => $entry['id']]` — the same source the
sidebar renders from, so the form can never offer an app the sidebar omits, nor
miss one it shows.

Two non-obvious constraints, both found by reading
`apps/settings/src/components/DeclarativeSettings/DeclarativeSection.vue`:

**`MULTI_CHECKBOX`, not `MULTI_SELECT`.** Multi-select passes `formField.options`
straight to `NcSelect` with no `label` prop (`DeclarativeSection.vue:51-67`), so
`{name, value}` objects never render their name — core's only working example
passes plain strings. That would list `projectcreatoraio` rather than "Projects".
Multi-checkbox reads `option.name` for the label and keys state by
`option.value` (`DeclarativeSection.vue:86-101`). Schema validation only checks
that `options` is an array (`DeclarativeManager.php:465`), so the wrong shape
fails silently at render rather than loudly at registration.

**The schema id is `visibility`, unprefixed.** The frontend posts
`form.id.replace(app + '_', '')` while `getForm()` matches
`$form->getSchema()['id']` exactly (`DeclarativeManager.php:282-290`). Naming it
`custom_layout_visibility` means the frontend sends `visibility` and the lookup
misses; an unprefixed id makes the strip a no-op and the two agree.

Consequence of `MULTI_CHECKBOX`: the stored value is a JSON **object**
(`{"adminpage": true}`), not an array — which is what `HiddenApps` decodes above.

### `AdminSection`

`IIconSection` with id `custom_layout`, name "Custom Layout", priority 75, icon
`img/app-dark.svg`. A dedicated section rather than a tab inside Theming, because
this controls the whole navigation.

`INavigationManager` keeps `TYPE_APPS` and `TYPE_SETTINGS` in separate lists
(`INavigationManager.php:43,49`), so enumerating app entries never offers
Settings as a hideable target. With no protected list, this is what guarantees
the route you un-hide from cannot itself be hidden.

### `HiddenAppMiddleware`

Registered with `registerMiddleware(HiddenAppMiddleware::class, global: true)`.
The `$global` flag is `@since 26` (`IRegistrationContext.php:135`) and
`DIContainer.php:239-244` injects global middleware into every app's dispatcher —
which is what lets `custom_layout` intercept requests bound for `deck` or
`calendar` rather than only its own routes.

```php
public function afterController($controller, $methodName, Response $response): Response {
    if (!$response instanceof TemplateResponse) {
        return $response;          // JSON, OCS, DAV, files — untouched
    }
    $slug = $this->slugForPath($this->request->getPathInfo());
    if ($slug === null || !in_array($slug, $this->hiddenApps->getHiddenAppIds(), true)) {
        return $response;
    }
    return new TemplateResponse('core', '403', [
        'message' => 'This app has been hidden by your administrator.',
    ], TemplateResponse::RENDER_AS_GUEST, Http::STATUS_FORBIDDEN);
}
```

`slugForPath()` matches `#^/apps/([^/?#]+)(/|$)#` against the path info and
returns the slug, or `null`.

`StandaloneTemplateResponse extends TemplateResponse`, so a single `instanceof`
check also covers login and public pages.

**Known trade-off.** Blocking in `afterController` means the page controller has
already executed. For GET page renders this is harmless. A POST route returning a
`TemplateResponse` would complete its side effect before the 403 — rare in
Nextcloud, where form posts return redirects or JSON, and accepted deliberately:
the alternative (`beforeController` on path) over-blocks plain non-OCS JSON routes
under `/apps/<slug>/api/`, which travel through `index.php` alongside real pages
and would cut against the core requirement that APIs keep working.

This is not hypothetical on this instance. `projectcreatoraio` declares **no OCS
routes at all** — its API is plain `Controller` routes such as
`project_api#listByUser` at `/apps/projectcreatoraio/api/v1/users/{userId}/projects`.
A path-based rule would take that API down along with the app's page; the
response-type rule leaves it serving.

Entry scripts confirm the split. `IRequest::getScriptName()` returns
`$_SERVER['SCRIPT_NAME']` verbatim (`Request.php:765`): pages arrive via
`index.php`, OCS via `ocs/v1.php` and `ocs/v2.php`, WebDAV/CalDAV/CardDAV via
`remote.php`, public shares via `public.php`. Only the first ever produces a
`TemplateResponse` for an app page.

### Listener change

```php
$initialState->provideLazyInitialState(
    'hidden_apps',
    fn () => $this->hiddenApps->getHiddenAppIds(),
);
```

The lazy variant is the documented pattern for exactly this situation:
*"Use this if your app is injected into pages. Since then the render method is
not called explicitly. But we do not want to load the state on webdav requests
for example."* The closure defers the appconfig read until a template genuinely
generates.

### `js/layout.js` change

A `readHiddenApps()` mirroring the existing `findAppLinksFromInitialState()`
decode pattern — `atob` + `JSON.parse` in a try/catch, `[]` on any failure —
read **once** in `start()` and cached in module state, since the value cannot
change without a page reload.

The filter goes in `rebuildSidebar()` immediately after
`findAppLinksFromInitialState() || findAppLinks()`. That position covers the
fallback DOM path for free, and means `signatureOf()` fingerprints the
already-filtered list, so the existing rebuild dedupe keeps working untouched.

`partitionByGroup()` already skips empty groups, so a group whose every app is
hidden drops its header with no further change.

## Edge cases

| Case | Behaviour |
|---|---|
| Malformed or absent config | `[]` — nothing hidden. Fail open. |
| Slug for an uninstalled app | Inert. Self-heals on next save, since the form only submits live options. |
| Already-open tabs | Keep showing the entry until reload, then 403 on click. |
| Nav entry pointing at an external URL | Filtered from the sidebar; not blocked, since it is not ours to block. |
| `custom_layout` itself | Has no navigation entry, so it never appears as an option. |

**Sharp edge — the default app.** Nextcloud redirects to the user's default entry
on login (`INavigationManager::getDefaultEntryIdForUser`). Hiding that app means
login lands directly on a 403, for every user, with no admin bypass to climb out
through. Recovery is Settings → Theming → Default app, or un-hiding. Fixing it
properly means intercepting default-entry resolution, which is outside a layout
app's remit. **Documented, not fixed.**

**Sharp edge — no Save button.** Multi-checkbox fields post on every click with no
debounce; the 1000ms debounce in `DeclarativeSection.vue:245` applies only to text
inputs. Combined with instance-wide scope and no admin bypass, one stray click
takes an app away from everyone. The declarative API offers no way to add a save
step or a confirmation. Accepted: recovery is one click back, and the settings
page is always reachable.

## Out of scope

Hidden apps still appear in unified search results, Dashboard widgets, and
Settings → Apps. "Hidden" means the sidebar and the app's own page, nothing
wider.

Also untouched: Nextcloud's own header menu (already suppressed by
`visibility: hidden` in `css/layout.css`), per-user overrides, per-group rules,
and app ordering.

## Verification

Playwright is the only harness available — a lone devDependency, gitignored,
with no PHP tests and no composer. Three checks, the third proving the premise:

Hide **Projects** (`projectcreatoraio`) for the run — it is the strongest case,
because its API is plain non-OCS routes through `index.php`, so it exercises the
exact distinction the block rule turns on.

```
sidebar omits the entry  →  reload, assert no .cl-item[href*="projectcreatoraio"]
page is blocked          →  GET /apps/projectcreatoraio/                        → 403
plain JSON API is live   →  GET /apps/projectcreatoraio/api/v1/users/admin/projects → 200
DAV is live              →  PROPFIND /remote.php/dav/files/admin/               → 207
```

The third line is the one that proves the premise: same entry script as the
blocked page, same URL prefix, different response type.

Plus, per CLAUDE.md, after any PHP or `info.xml` edit:

```bash
docker exec -u www-data master-nextcloud-1 php occ app:disable custom_layout
docker exec -u www-data master-nextcloud-1 php occ app:enable custom_layout
```

Manual checks worth running once: hide the app that is the default app and
confirm the documented login behaviour; corrupt `hidden_apps` by hand and
confirm the sidebar renders complete rather than empty.

## References

Verified against `workspace/server`, Nextcloud 34.0.0 dev.

- `lib/public/AppFramework/Bootstrap/IRegistrationContext.php:135` — `registerMiddleware($class, $global)`
- `lib/public/AppFramework/Bootstrap/IRegistrationContext.php:393` — `registerDeclarativeSettings()`
- `lib/private/AppFramework/DependencyInjection/DIContainer.php:239-244` — global middleware wiring
- `lib/private/AppFramework/Http/Request.php:765` — `getScriptName()`
- `lib/private/Settings/DeclarativeManager.php:282-290` — `getForm()` exact id match
- `lib/private/Settings/DeclarativeManager.php:301,343` — internal storage read/write
- `lib/private/AppConfig.php:446-460` — `getValueArray()` typed read
- `lib/public/INavigationManager.php:43,49` — `TYPE_APPS` / `TYPE_SETTINGS`
- `apps/settings/src/components/DeclarativeSettings/DeclarativeSection.vue:51-101,245`
