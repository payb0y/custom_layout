<?php
/**
 * Custom Layout — modern SaaS-style sidebar for Nextcloud.
 *
 * Registers a global stylesheet and script that transforms the default
 * top app menu into a foldable left sidebar. Loaded on every page via
 * the legacy app.php bootstrap (still honored by Nextcloud 32 for
 * `\OCP\Util::addStyle()` / `addScript()` calls).
 */

// Defensive: only register assets when the OCP API is available.
if (!class_exists(\OCP\Util::class)) {
	return;
}

// Register on every request — these helpers are no-ops on requests that
// don't render the standard layout (e.g. WebDAV, OCS API endpoints).
\OCP\Util::addStyle('custom_layout', 'layout');
\OCP\Util::addScript('custom_layout', 'layout');
