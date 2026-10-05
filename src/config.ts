import vscode from 'vscode';
import {
	CONFIG_SECTION,
	DEFAULT_BASE_URL,
	DEFAULT_CATALOG_BASE_URL,
	DEFAULT_CATALOG_REFRESH_MINUTES,
	DEFAULT_CLI_REFERENCE_BASE_URL,
	DEFAULT_PLAN_BASE_URL,
} from './consts';
import { normalizeBaseUrl } from './endpoint';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';
const DEBUG_MODES = ['minimal', 'metadata', 'verbose'] as const satisfies readonly DebugMode[];

/**
 * Get the configured max output tokens limit.
 * Returns `undefined` when set to 0 (API default — no limit).
 */
export function getMaxTokens(): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('maxTokens', 0);
	return value > 0 ? value : undefined;
}

/**
 * Whether to attach the `x-cmd-zdr: 1` header on every request.
 */
export function getZdrEnabled(): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<boolean>('zdr', false);
}

export function getDebugMode(): DebugMode {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mode = config.get<string>('debugMode');
	if (DEBUG_MODES.includes(mode as DebugMode)) {
		return mode as DebugMode;
	}
	return 'minimal';
}

export function getDebugLoggingEnabled(): boolean {
	return getDebugMode() !== 'minimal';
}

// ---- Model list ----

/**
 * Base URL of the plan documentation page that supplies the model list.
 *
 * Defaults to the official docs. The plan slug itself is fixed to `go` — this
 * extension supports the Go plan only, so it is not a setting.
 */
export function getPlanBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return normalizeBaseUrl(config.get<string>('planBaseUrl') || DEFAULT_PLAN_BASE_URL);
}

/**
 * Base URL of the CLI reference pages, whose model table is the supported
 * source of canonical model ids on the Go plan.
 */
export function getCliReferenceBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return normalizeBaseUrl(
		config.get<string>('cliReferenceBaseUrl') || DEFAULT_CLI_REFERENCE_BASE_URL,
	);
}

/**
 * Base URL of the API catalog, consulted only for canonical model ids.
 *
 * Kept separate from `getPlanBaseUrl()` because the two surfaces are disjoint:
 * the docs page names models by slug (`kimi-k3`) while the Generate API expects
 * `moonshotai/Kimi-K3`.
 */
export function getCatalogBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return normalizeBaseUrl(config.get<string>('catalogBaseUrl') || DEFAULT_CATALOG_BASE_URL);
}

/** Base URL of the Generate API that serves chat requests. */
export function getGenerateBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return normalizeBaseUrl(config.get<string>('generateBaseUrl') || DEFAULT_BASE_URL);
}

/**
 * Minutes before the stored model list is refetched.
 *
 * This is what makes the list track the plan without an extension update: the
 * docs page is consulted on first run, then whenever the snapshot is older than
 * this. Repeat queries inside the window are served from storage and cost
 * nothing.
 */
export function getCatalogRefreshMinutes(): number {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('catalogRefreshMinutes', DEFAULT_CATALOG_REFRESH_MINUTES);
	return value > 0 ? value : DEFAULT_CATALOG_REFRESH_MINUTES;
}

/**
 * How the picker is populated.
 *
 * `dynamic` builds the list from the plan page. `static` keeps only the curated
 * registry compiled into `models.ts` and makes no network requests at all.
 */
export type ModelSource = 'dynamic' | 'static';

export function getModelSource(): ModelSource {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<string>('modelSource', 'dynamic') === 'static' ? 'static' : 'dynamic';
}

/** Models hidden from the picker, matched on model id. */
export function getModelBlacklist(): string[] {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<string[]>('modelBlacklist') ?? [];
}

/**
 * Override the context window reported to Copilot for every model. 0 keeps the
 * plan page's own figure.
 */
export function getMaxContextTokensOverride(): number {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('maxContextTokens', 0);
	return value > 0 ? value : 0;
}
