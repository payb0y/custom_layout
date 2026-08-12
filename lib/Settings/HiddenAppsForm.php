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
			// matches the schema id exactly. An unprefixed id makes that strip a
			// no-op so the two agree.
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
					// entries never render their name. Multi-checkbox reads
					// option.name explicitly.
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
