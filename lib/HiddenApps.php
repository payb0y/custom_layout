<?php

declare(strict_types=1);

namespace OCA\CustomLayout;

use OCA\CustomLayout\AppInfo\Application;
use OCP\IAppConfig;

/**
 * Sole owner of the `hidden_apps` config key.
 *
 * Nextcloud's declarative settings persists the multi-checkbox field through
 * IAppConfig::setValueString(), so the row is typed VALUE_STRING holding a JSON
 * object like {"deck":true,"files":false}. Reading it back with getValueArray()
 * performs a VALUE_ARRAY typed read and throws AppConfigTypeConflictException on
 * the mismatch — so we read the string and decode by hand, and nothing else
 * touches this key.
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
