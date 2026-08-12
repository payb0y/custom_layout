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
