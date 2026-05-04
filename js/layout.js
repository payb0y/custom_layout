/**
 * Custom Layout — modern SaaS-style sidebar for Nextcloud 32.
 *
 * Strategy:
 *   1. Wait for DOM ready.
 *   2. Detect the default top app menu (#appmenu and friends).
 *   3. Clone its links into a fixed left sidebar with grouped sections.
 *   4. Observe DOM mutations to handle late-rendered Vue components and
 *      route changes (active-state highlighting).
 *
 * The original DOM is never destroyed — only hidden via CSS — so any
 * Nextcloud feature that scripts the original menu keeps working.
 */
(function () {
  "use strict";

  // --- Configuration --------------------------------------------------------

  /**
   * Grouping config. An app belongs to a group if its slug (URL segment under
   * /apps/...) matches `apps[]` OR its display label matches `labels[]`
   * (case-insensitive, trimmed). Apps that match nothing land in OTHER.
   *
   * Use `apps` for stock NC apps (slugs are stable across installs).
   * Use `labels` for custom apps where the slug differs per deployment —
   * the displayed name is easier to keep in sync.
   */
  const GROUPS = [
    {
      title: "OVERVIEW",
      apps: ["dashboard", "employee_dashboard", "adminpage", "superadminpage"],
      labels: [],
    },
    {
      title: "PROJECTS",
      apps: ["scrumban", "projects", "organizations"],
      labels: ["Scrumban", "Projects", "Organizations"],
    },
    {
      title: "COLLABORATION",
      apps: [
        "files",
        "photos",
        "gallery",
        "activity",
        "mail",
        "contacts",
        "calendar",
        "notes",
        "spreed",
        "talk",
        "deck",
        "tasks",
        "forms",
        "collectives",
      ],
      labels: ["Talk"],
    },
  ];

  const STORAGE_KEY = "cl:sidebar:mode";
  const LEGACY_STORAGE_KEY = "cl:sidebar:collapsed";

  const MODE_HIDDEN = "hidden";
  const MODE_RAIL = "rail";
  const MODE_EXPANDED = "expanded";
  const VALID_MODES = [MODE_HIDDEN, MODE_RAIL, MODE_EXPANDED];

  // Module state: persisted preference + transient peek flag (peek is the
  // auto-closing reveal that happens while the persisted mode is "hidden").
  let currentMode = MODE_RAIL;
  let isPeeking = false;

  const SVG_NS = "http://www.w3.org/2000/svg";

  /** Selectors tried, in order, to find the source app menu (NC 25–32). */
  const APPMENU_SELECTORS = [
    "header nav.app-menu .app-menu-entry > a",
    "header nav.app-menu li > a",
    "#appmenu li[data-app-id] > a",
    "#appmenu .app-menu-entry > a",
    "#appmenu ul > li > a",
    "#navigation .app-menu li > a",
    "#header nav#navigation li > a",
  ];

  /** Selectors for any "more apps" overflow trigger. */
  const MORE_APPS_SELECTORS = [
    "header nav.app-menu .app-menu-entry--more a",
    "header .app-menu-more a",
    "#header .app-menu-more a",
    '#header [data-id="more-apps"] a',
    'a[href$="/settings/apps"]',
  ];

  // --- Tiny helpers ---------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function findAppLinks() {
    for (const sel of APPMENU_SELECTORS) {
      const links = $$(sel);
      if (links.length > 0) {
        return links;
      }
    }
    return [];
  }

  function findMoreAppsLink() {
    for (const sel of MORE_APPS_SELECTORS) {
      const link = $(sel);
      if (link) {
        return link;
      }
    }
    return null;
  }

  function getAppId(link) {
    const li = link.closest("li[data-app-id]");
    if (li && li.dataset.appId) return li.dataset.appId;
    if (link.dataset && link.dataset.appId) return link.dataset.appId;

    const href = link.getAttribute("href") || "";
    const m = href.match(/\/apps\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function getAppLabel(link) {
    const span = link.querySelector(
      '.app-menu-entry__label, .app-menu-entry-label, span:not([class*="icon"])',
    );
    if (span && span.textContent.trim()) return span.textContent.trim();
    if (link.getAttribute("aria-label"))
      return link.getAttribute("aria-label").trim();
    const text = link.textContent.trim();
    if (text) return text;
    const id = getAppId(link);
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : "App";
  }

  /**
   * Build an icon DOM node for a source link.
   * Uses DOM APIs (no innerHTML) to keep things XSS-safe even if the
   * upstream menu is compromised: the only attacker-controlled value
   * we propagate is the icon URL, set via setAttribute('src', ...).
   */
  function buildIconNode(link) {
    const sourceImg = link.querySelector("img");
    if (sourceImg && sourceImg.getAttribute("src")) {
      const img = document.createElement("img");
      img.setAttribute("src", sourceImg.getAttribute("src"));
      img.setAttribute("alt", "");
      img.setAttribute("aria-hidden", "true");
      return img;
    }

    const sourceSvg = link.querySelector("svg");
    if (sourceSvg) {
      // cloneNode keeps SVG structure without going through innerHTML.
      return sourceSvg.cloneNode(true);
    }

    const id = getAppId(link);
    if (id) {
      const img = document.createElement("img");
      // App ids are slug-style (lowercase, [a-z0-9_-]); the path is
      // constructed server-side and not attacker-influenced.
      img.setAttribute(
        "src",
        "/apps/" + encodeURIComponent(id) + "/img/app.svg",
      );
      img.setAttribute("alt", "");
      img.setAttribute("aria-hidden", "true");
      return img;
    }

    // Empty fallback — keep the slot so layout doesn't shift.
    return document.createElement("span");
  }

  function isActive(link) {
    if (link.classList.contains("active")) return true;
    if (link.getAttribute("aria-current")) return true;
    const li = link.closest("li");
    if (li) {
      // NC 25-32: parent <li> carries app-menu-entry--active when current.
      if (li.classList.contains("active")) return true;
      if (li.classList.contains("app-menu-entry--active")) return true;
    }

    const href = link.getAttribute("href");
    if (href && location.pathname.indexOf(href) === 0) return true;
    return false;
  }

  // --- Static SVG factories (safe — no untrusted input) ---------------------

  function makeChevronSvg() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const poly = document.createElementNS(SVG_NS, "polyline");
    poly.setAttribute("points", "15 18 9 12 15 6");
    svg.appendChild(poly);
    return svg;
  }

  function makeMoreAppsSvg() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    [5, 12, 19].forEach((cx) => {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", "12");
      c.setAttribute("r", "1.6");
      svg.appendChild(c);
    });
    return svg;
  }

  // --- Sidebar construction -------------------------------------------------

  let sidebarEl = null; // root element
  let scrollEl = null; // groups container
  let footerEl = null; // footer container ("More apps")
  let lastSignature = ""; // dedupe rebuilds

  function ensureSidebarShell() {
    if (sidebarEl && document.body.contains(sidebarEl)) return;

    sidebarEl = document.createElement("aside");
    sidebarEl.className = "cl-sidebar";
    sidebarEl.setAttribute("role", "navigation");
    sidebarEl.setAttribute("aria-label", "Custom application sidebar");

    const toggleBar = document.createElement("div");
    toggleBar.className = "cl-sidebar__toggle-bar";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "cl-sidebar__toggle";
    toggleBtn.setAttribute("aria-label", "Toggle sidebar");
    toggleBtn.appendChild(makeChevronSvg());
    toggleBtn.addEventListener("click", onToggleClick);
    toggleBar.appendChild(toggleBtn);

    scrollEl = document.createElement("div");
    scrollEl.className = "cl-sidebar__scroll";

    footerEl = document.createElement("div");
    footerEl.className = "cl-sidebar__footer";

    sidebarEl.appendChild(toggleBar);
    sidebarEl.appendChild(scrollEl);
    sidebarEl.appendChild(footerEl);

    document.body.appendChild(sidebarEl);

    // Auto-close the transient peek reveal after tapping an app link, so a
    // user in "hidden" mode can glance at the menu, navigate, and end up
    // with the sidebar tucked away again. Pinned modes (rail/expanded)
    // stay put — taps there do not change state.
    sidebarEl.addEventListener("click", (e) => {
      if (e.target.closest(".cl-item") && isPeeking) {
        isPeeking = false;
        applyState();
      }
    });
  }

  function buildItem(link) {
    const a = document.createElement("a");
    a.className = "cl-item";
    a.href = link.getAttribute("href") || "#";
    const target = link.getAttribute("target");
    if (target) a.target = target;
    const rel = link.getAttribute("rel");
    if (rel) a.rel = rel;

    if (isActive(link)) {
      a.classList.add("cl-item--active");
    }

    const label = getAppLabel(link);

    const iconWrap = document.createElement("span");
    iconWrap.className = "cl-item__icon";
    iconWrap.appendChild(buildIconNode(link));

    const labelEl = document.createElement("span");
    labelEl.className = "cl-item__label";
    labelEl.textContent = label;

    a.title = label; // helpful when collapsed
    a.appendChild(iconWrap);
    a.appendChild(labelEl);

    return a;
  }

  function buildGroup(title, links) {
    const group = document.createElement("div");
    group.className = "cl-group";

    const titleEl = document.createElement("div");
    titleEl.className = "cl-group__title";
    titleEl.textContent = title;
    group.appendChild(titleEl);

    links.forEach((link) => group.appendChild(buildItem(link)));
    return group;
  }

  /**
   * Sort `links` into the configured groups.
   * Returns an array of {title, links} preserving GROUPS order, plus a
   * trailing "OTHER" bucket if anything is left over.
   */
  function partitionByGroup(links) {
    const byApp = new Map();
    const labelToId = new Map();
    links.forEach((link) => {
      const id = getAppId(link);
      // First-seen wins — Nextcloud sometimes lists the same app twice
      // (visible + overflow). The sidebar should show each app once.
      const key = id || "__anon_" + byApp.size;
      if (!byApp.has(key)) {
        byApp.set(key, link);
        const label = getAppLabel(link).toLowerCase().trim();
        if (label && !labelToId.has(label)) {
          labelToId.set(label, key);
        }
      }
    });

    const used = new Set();
    const result = [];

    GROUPS.forEach((g) => {
      const groupLinks = [];
      const push = (key) => {
        if (used.has(key)) return;
        groupLinks.push(byApp.get(key));
        used.add(key);
      };
      (g.apps || []).forEach((appId) => {
        if (byApp.has(appId)) push(appId);
      });
      (g.labels || []).forEach((label) => {
        const key = labelToId.get(label.toLowerCase().trim());
        if (key) push(key);
      });
      if (groupLinks.length > 0) {
        result.push({ title: g.title, links: groupLinks });
      }
    });

    const leftover = [];
    byApp.forEach((link, key) => {
      if (!used.has(key)) leftover.push(link);
    });
    if (leftover.length > 0) {
      result.push({ title: "OTHER", links: leftover });
    }

    return result;
  }

  /**
   * Cheap signature of the menu so we only rebuild when something
   * actually changed (id list + active id).
   */
  function signatureOf(links) {
    const ids = links.map((l) => {
      const id = getAppId(l) || l.getAttribute("href") || "";
      return isActive(l) ? "*" + id : id;
    });
    return ids.join("|");
  }

  function rebuildSidebar() {
    const links = findAppLinks();
    if (links.length === 0) return false;

    ensureSidebarShell();

    const sig = signatureOf(links);
    if (sig === lastSignature) return true;
    lastSignature = sig;

    scrollEl.replaceChildren();
    footerEl.replaceChildren();

    const groups = partitionByGroup(links);
    // Fall back to a flat list if grouping yielded nothing meaningful.
    if (
      groups.length === 0 ||
      (groups.length === 1 && groups[0].title === "OTHER")
    ) {
      links.forEach((l) => scrollEl.appendChild(buildItem(l)));
    } else {
      groups.forEach((g) => scrollEl.appendChild(buildGroup(g.title, g.links)));
    }

    // "More apps" footer, if discoverable.
    const more = findMoreAppsLink();
    if (more) {
      const item = buildItem(more);
      const lbl = item.querySelector(".cl-item__label");
      if (lbl) lbl.textContent = "More apps";
      const ic = item.querySelector(".cl-item__icon");
      if (ic && !ic.querySelector("img") && !ic.querySelector("svg")) {
        ic.replaceChildren(makeMoreAppsSvg());
      }
      footerEl.appendChild(item);
    }

    // Tell the CSS it is safe to hide the original menu now that we've
    // cloned its items. Doing this earlier breaks Vue's responsive layout
    // measurement and empties the menu into the overflow popup.
    document.body.classList.add("cl-applied");

    return true;
  }

  // --- Sidebar state machine ------------------------------------------------
  //
  // Three persisted modes (the user's preference):
  //   - "hidden":   sidebar tucked off-screen, only the chevron pill remains.
  //   - "rail":     icon-only rail visible (88px), pinned.
  //   - "expanded": full sidebar visible (260px), pinned.
  //
  // Plus one transient flag: `isPeeking`. While the persisted mode is
  // "hidden", the user can tap the chevron pill to slide the rail in for a
  // glance; tapping a link auto-closes back to hidden. Peek is never
  // persisted.
  //
  // The chevron cycles modes:
  //   - desktop (>1024px): hidden → rail → expanded → hidden
  //   - tablet/mobile (<=1024px): hidden → rail → hidden
  //     (expanded is skipped; on those viewports the CSS clamps "expanded"
  //     to look like "rail" anyway, so the cycle would feel like a no-op.)

  function isWideViewport() {
    return !window.matchMedia("(max-width: 1024px)").matches;
  }

  function applyState() {
    document.body.dataset.clMode = currentMode;
    document.body.classList.toggle(
      "cl-sidebar-peek",
      isPeeking && currentMode === MODE_HIDDEN,
    );
  }

  function persistMode() {
    try {
      localStorage.setItem(STORAGE_KEY, currentMode);
    } catch (_) {
      /* private mode etc. — ignore */
    }
  }

  function loadStateFromStorage() {
    let mode = MODE_RAIL;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (VALID_MODES.indexOf(stored) !== -1) {
        mode = stored;
      } else {
        // One-time migration of the old boolean flag from the
        // collapsed/expanded era.
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy === "1") mode = MODE_RAIL;
        else if (legacy === "0") mode = MODE_EXPANDED;
        if (legacy !== null) {
          localStorage.setItem(STORAGE_KEY, mode);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
    } catch (_) {
      /* ignore */
    }
    currentMode = mode;
    isPeeking = false;
    applyState();
  }

  function setMode(mode) {
    currentMode = mode;
    isPeeking = false;
    persistMode();
    applyState();
  }

  function onToggleClick() {
    if (currentMode === MODE_HIDDEN) {
      if (isPeeking) {
        // Peek → commit to pinned rail. The user has signalled "yes,
        // keep it visible".
        setMode(MODE_RAIL);
      } else {
        // First tap from hidden → transient reveal. Preference stays
        // "hidden" so a link tap (or another chevron press) returns to
        // the tucked-away state.
        isPeeking = true;
        applyState();
      }
      return;
    }
    if (currentMode === MODE_RAIL) {
      setMode(isWideViewport() ? MODE_EXPANDED : MODE_HIDDEN);
      return;
    }
    // currentMode === MODE_EXPANDED
    setMode(MODE_HIDDEN);
  }

  // --- Bootstrap ------------------------------------------------------------

  function start() {
    loadStateFromStorage();
    rebuildSidebar();

    const observer = new MutationObserver(() => {
      // rAF throttling — coalesce rebuild storms during Vue mounts.
      if (start._scheduled) return;
      start._scheduled = true;
      requestAnimationFrame(() => {
        start._scheduled = false;
        rebuildSidebar();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-current", "data-app-id"],
    });

    window.addEventListener("popstate", () => {
      lastSignature = "";
      rebuildSidebar();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
