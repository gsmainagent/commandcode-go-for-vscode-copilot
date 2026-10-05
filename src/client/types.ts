export interface ErrorActionUrls {
	configureApiKey?: string;
	showLogs?: string;
	createApiKey?: string;
	viewPricing?: string;
}

export interface RequestErrorContext {
	/**
	 * Base URL the request went to, for diagnostics.
	 *
	 * The upstream protocol is the vendored proxy's, so there is no request
	 * envelope to carry here; the model name is passed on its own.
	 */
	baseUrl: string;
	/** Model being requested, when the failure is known to relate to one. */
	model?: string;
}

export interface ErrorActionLink {
	labelKey: ErrorActionLabelKey;
	url: string;
}

export type ErrorActionLabelKey = 'error.action.createApiKey' | 'error.action.viewPricing';

export interface HttpErrorLinkDefinition {
	labelKey: ErrorActionLabelKey;
	url: string;
}

export type ApiProviderId = 'commandcode';
export type HttpErrorLinkStatusKey = 401 | 403 | 422 | 429 | '5xx';

export type CommandCodeRequestErrorKind = 'http' | 'network' | 'unknown';

export type NetworkErrorCategory =
	| 'dns'
	| 'unreachable'
	| 'interrupted'
	| 'timeout'
	| 'tls'
	| 'aborted'
	| 'protocol'
	| 'configuration'
	| 'generic';
