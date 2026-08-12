<?php

declare(strict_types=1);

namespace OCA\CustomLayout\AppInfo;

use OCA\CustomLayout\Listener\BeforeTemplateRenderedListener;
use OCA\CustomLayout\Middleware\HiddenAppMiddleware;
use OCA\CustomLayout\Settings\HiddenAppsForm;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'custom_layout';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		// Inject our global stylesheet and script before each rendered template.
		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			BeforeTemplateRenderedListener::class
		);

		$context->registerDeclarativeSettings(HiddenAppsForm::class);

		// global: true — this must see requests bound for every app, not just
		// ours. The flag is @since NC 26, and DIContainer injects such
		// middleware into every app's dispatcher.
		$context->registerMiddleware(HiddenAppMiddleware::class, true);
	}

	public function boot(IBootContext $context): void {
	}
}
