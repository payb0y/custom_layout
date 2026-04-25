<?php

declare(strict_types=1);

namespace OCA\CustomLayout\Listener;

use OCA\CustomLayout\AppInfo\Application;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * @implements IEventListener<BeforeTemplateRenderedEvent>
 */
class BeforeTemplateRenderedListener implements IEventListener {
	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent) {
			return;
		}
		Util::addStyle(Application::APP_ID, 'layout');
		Util::addScript(Application::APP_ID, 'layout');
	}
}
