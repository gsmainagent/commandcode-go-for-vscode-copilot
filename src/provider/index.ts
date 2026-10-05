import vscode from 'vscode';
import { AuthManager } from '../auth';
import { t } from '../i18n';
import { logger } from '../logger';
import { getLiveCatalog, type LiveCatalog } from '../catalog';
import {
	getCatalogBaseUrl,
	getCatalogRefreshMinutes,
	getCliReferenceBaseUrl,
	getMaxTokens,
	getModelBlacklist,
	getModelSource,
	getPlanBaseUrl,
	getUpstreamProxy,
} from '../config';
import { VENDOR_ID } from '../consts';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { ensureProxy, stopProxy } from '../proxy-process';
import { estimateTokenCount } from './tokens';
import { MODELS, toModelDefinition } from '../models';
import type { ModelDefinition } from '../types';

/**
 * Command Code Go Chat Provider — implements `vscode.LanguageModelChatProvider`
 * so Command Code models appear directly in the Copilot Chat model picker.
 *
 * The picker is built from the Go plan page (`catalog.ts`) and falls back to the
 * static registry in `models.ts` when that page cannot be read or the
 * `modelSource` setting is `static`.
 */
export class CommandCodeChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly globalState: vscode.Memento;
	/** Absolute path of the installed extension, where the vendored proxy sits. */
	private readonly extensionPath: string;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;
	/**
	 * Resolved definitions for every model the picker offers, so
	 * `provideLanguageModelChatResponse` can look up capabilities without
	 * rebuilding them. Refreshed on every picker query.
	 */
	private modelById = new Map<string, ModelDefinition>();
	/** Set when the user explicitly asks to re-fetch the model list. */
	private catalogSyncRequested = false;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	/**
	 * Adaptive chars-per-token ratio, calibrated from real usage data via an
	 * exponential moving average each time the API reports token counts.
	 */
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);
		this.globalState = context.globalState;
		this.extensionPath = context.extensionPath;

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			// The API key may be stored in settings or SecretStorage.
			vscode.workspace.onDidChangeConfiguration((e) => {
				// The proxy reads its upstream proxy from the environment it was
				// spawned with, and `ensureProxy` returns the running instance as
				// soon as one is ready. So a new value cannot be picked up by the
				// existing process: stop it, and the next request spawns a fresh
				// one with the new environment. Without this, the setting would
				// appear inert until the window reloaded.
				if (e.affectsConfiguration('commandcode-copilot.upstreamProxy')) {
					stopProxy();
				}
				if (
					e.affectsConfiguration('commandcode-copilot.apiKey') ||
					e.affectsConfiguration('commandcode-copilot.catalogBaseUrl') ||
					e.affectsConfiguration('commandcode-copilot.modelSource') ||
					e.affectsConfiguration('commandcode-copilot.modelBlacklist') ||
					e.affectsConfiguration('commandcode-copilot.modelIdOverrides') ||
					e.affectsConfiguration('commandcode-copilot.maxContextTokens')
				) {
					this.refreshModelPicker();
				}
			}),
			// Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
			context.secrets.onDidChange((e) => {
				if (e.key === 'commandcode-copilot.apiKey') {
					this.refreshModelPicker();
				}
			}),
		);
	}

	// ---- Public commands ----

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.refreshModelPicker();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.refreshModelPicker();
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	/** Force Copilot Chat to re-query model information. */
	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	/**
	 * Re-fetch the model list from the plan page. Wired to the "Refresh Models"
	 * command and URI action.
	 */
	async refreshModelsFromApi(token?: vscode.CancellationToken): Promise<void> {
		this.catalogSyncRequested = true;
		try {
			const catalog = await this.resolveCatalog(token);
			logger.info(`Refreshed model list from ${catalog.source}: ${catalog.models.size} models`);
			void vscode.window.showInformationMessage(t('models.refreshSucceeded', catalog.models.size));
		} catch (error) {
			logger.error('Model list refresh failed', error);
			void vscode.window.showErrorMessage(
				t('models.refreshFailed', error instanceof Error ? error.message : String(error)),
			);
		} finally {
			this.refreshModelPicker();
		}
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();

		// Trigger one final sync pull so the picker drops our entries immediately
		// instead of waiting for the host to invalidate its cache. With
		// `isActive = false` we return [], which makes Copilot Chat drop
		// Command Code models from the picker immediately on deactivate.
		try {
			await vscode.lm.selectChatModels({ vendor: VENDOR_ID });
		} catch (error) {
			logger.warn('Failed to refresh Command Code models during deactivate', error);
		}

		// The proxy is a child process, so a reload would otherwise leave one
		// running and holding a port. Stop it here, after the picker has been
		// cleared so no in-flight request depends on it.
		stopProxy();
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		const hasKey = await this.authManager.hasApiKey();
		const blacklist = new Set(getModelBlacklist());
		const source = getModelSource();
		// Read once here so the picker's reported window and the request's
		// `max_tokens` are derived from the same setting.
		const configuredMaxTokens = getMaxTokens();

		let definitions: ModelDefinition[];

		if (source === 'static') {
			// Explicit opt-out: curated registry only, no network.
			definitions = [...MODELS];
		} else {
			const catalog = await this.resolveCatalog(token);

			// The plan page is the model list. With nothing to show — no key yet,
			// docs unreachable, nothing cached — the curated registry is still
			// better than an empty picker.
			definitions =
				catalog.models.size > 0
					? [...catalog.models.values()].map((model) =>
							toModelDefinition(model.id, model, configuredMaxTokens),
						)
					: [...MODELS];
		}

		definitions = definitions.filter((model) => !blacklist.has(model.id));
		this.modelById = new Map(definitions.map((model) => [model.id, model]));

		return definitions.map((model) => toChatInfo(model, hasKey));
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const modelDefinition = this.modelById.get(modelInfo.id);

		const proxyState = await ensureProxy({
			extensionPath: this.extensionPath,
			upstreamProxy: getUpstreamProxy(),
			token,
		});
		if (proxyState.status !== 'ready' || !proxyState.endpoint) {
			// No direct path exists: the upstream protocol now lives only in the
			// vendored proxy, so a failed start means no answer at all. Saying so
			// plainly beats surfacing a confusing upstream error later.
			const reason = proxyState.error ?? 'unknown reason';
			logger.error(`Command Code proxy unavailable: ${reason}`);
			throw vscode.l10n.t('The Command Code proxy could not start: {0}', reason);
		}

		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			endpoint: proxyState.endpoint,
			modelInfo,
			modelDefinition,
			messages,
			options,
		});

		return streamChatCompletion({
			prepared,
			progress,
			token,
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}

	// ---- catalog ----

	/**
	 * Resolve the model list, consuming the pending explicit-refresh flag.
	 *
	 * Never throws: `catalog.ts` degrades to the stored snapshot, then to an
	 * empty catalog, and the caller falls back to the curated registry.
	 */
	private async resolveCatalog(token?: vscode.CancellationToken): Promise<LiveCatalog> {
		const forceRefresh = this.catalogSyncRequested;
		this.catalogSyncRequested = false;

		const apiKey = await this.authManager.getApiKey();
		const catalog = await getLiveCatalog({
			globalState: this.globalState,
			apiKey,
			planBaseUrl: getPlanBaseUrl(),
			catalogBaseUrl: getCatalogBaseUrl(),
			cliReferenceBaseUrl: getCliReferenceBaseUrl(),
			// The compiled registry is the one id source that needs no network, so
			// it is passed in rather than imported: `catalog.ts` stays free of the
			// registry so the two cannot form a cycle.
			registryIds: MODELS.map((model) => model.id),
			refreshMinutes: getCatalogRefreshMinutes(),
			forceRefresh,
			token,
		});

		if (catalog.fromNetwork) {
			logger.info(`Model list ready from ${catalog.source}: ${catalog.models.size} models`);
		} else if (catalog.stale) {
			logger.warn(
				`Model list served from a stale snapshot (${catalog.models.size} models); ` +
					'the plan page could not be reached',
			);
		}

		return catalog;
	}
}

export { VENDOR_ID as PROVIDER_VENDOR, MODELS };
