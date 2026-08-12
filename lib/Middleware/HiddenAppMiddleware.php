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
 *
 * No IL10N here on purpose. A global middleware is built inside whichever app's
 * container is handling the request, so an injected IL10N would resolve to that
 * app's translation domain rather than ours. This app ships no l10n/ directory,
 * so a plain string is both simpler and more honest.
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
			['message' => 'This app has been hidden by your administrator.'],
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
