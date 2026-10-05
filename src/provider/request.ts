import vscode from 'vscode';
import { AuthManager } from '../auth';
import { getDebugLoggingEnabled, getMaxTokens, getZdrEnabled } from '../config';
import { t } from '../i18n';
import { logger } from '../logger';
import { outputCeilingFor } from '../output-ceiling';
import type { ChatMessage, ChatTool, ModelDefinition, ThinkingEffort } from '../types';
import type { OpenAITool, ProxyClientOptions, ProxyRequest } from '../client/proxy-client';
import { convertMessages, convertTools, countMessageChars } from './convert';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';

export interface PreparedChatRequest {
	readonly proxy: ProxyClientOptions;
	readonly request: ProxyRequest;
	/** Character count of the conversation, used to calibrate tokens-per-char. */
	readonly totalRequestChars: number;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	/** Where the vendored proxy is listening, from `ensureProxy`. */
	endpoint: { readonly baseUrl: string; readonly port: number };
	modelInfo: vscode.LanguageModelChatInformation;
	modelDefinition: ModelDefinition | undefined;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
}

/**
 * Build an OpenAI-shaped request for the vendored proxy.
 *
 * ## Why this is OpenAI-shaped
 *
 * The proxy exposes `/v1/chat/completions`, so this is the wire format — not an
 * intermediate step. The second conversion hop is gone: no `input_schema`, no
 * `{ type: 'tool-call' }` parts, no envelope. What remains is one conversion,
 * from VS Code's parts to OpenAI's.
 *
 * ## Where the request envelope comes from
 *
 * The proxy builds it. That is a compatibility requirement, not a shortcut: the
 * upstream CLI always sends `config.workingDir`, while VS Code may run with no
 * folder open at all, so a working directory has to be supplied by something. The
 * proxy supplies a plausible one, and the same profile drives the device
 * fingerprint — which is also what makes it worthwhile, since a real local path
 * would be a strong identifier in every request.
 *
 * As a consequence the git context this extension used to collect — branch, main
 * branch, status, recent commits — is not sent upstream. Local paths and commit
 * subjects are exactly the kind of identifying detail the profile exists to keep
 * out of requests.
 */
export async function prepareChatRequest({
	authManager,
	endpoint,
	modelInfo,
	modelDefinition,
	messages,
	options,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const thinkingCapability = modelDefinition?.capabilities.thinking;
	const imageInput = modelDefinition?.capabilities.imageInput ?? false;
	const configuredMaxTokens = getMaxTokens();
	// The definition's `maxOutputTokens` came from `resolveTokenBudget`, the same
	// function that produced the number reported to Copilot. Reusing it here is
	// what keeps the two from drifting: a context override or a `maxTokens`
	// setting moves both sides together.
	const maxTokens = modelDefinition?.maxOutputTokens ?? configuredMaxTokens;

	const chatMessages = convertMessages(messages, { imageInput });
	const tools = prepareTools(modelDefinition?.capabilities.toolCalling, options);

	const thinkingEffort: ThinkingEffort = thinkingCapability
		? getConfiguredThinkingEffort(options as ModelConfigurationOptions, thinkingCapability)
		: 'none';

	const request: ProxyRequest = {
		model: modelInfo.id,
		messages: chatMessages,
		...(tools?.length ? { tools: tools as readonly OpenAITool[] } : {}),
		// `maxTokens` comes from the model definition, which already applied this
		// model's own ceiling. The fallback repeats that ceiling for the case where
		// no definition was found, so an unknown model is never sent more than it
		// accepts. Sending the budget also keeps the reported figure and the sent
		// figure in agreement.
		maxTokens: maxTokens ?? outputCeilingFor(modelInfo.id),
		temperature: 0.3,
		// `none` omits the field so the upstream model uses its default
		// non-thinking behaviour, rather than being told to disable thinking.
		...(thinkingEffort !== 'none' ? { reasoningEffort: thinkingEffort } : {}),
	};

	const proxy: ProxyClientOptions = {
		baseUrl: endpoint.baseUrl,
		apiKey,
		...(getZdrEnabled() ? { zeroDataRetention: true } : {}),
		...(getDebugLoggingEnabled() ? { debug: true } : {}),
	};

	logger.debug(
		`Prepared request: model=${request.model} messages=${chatMessages.length} ` +
			`tools=${tools?.length ?? 0} thinking=${thinkingEffort} ` +
			`maxTokens=${request.maxTokens} via proxy:${endpoint.port}`,
	);

	return {
		proxy,
		request,
		totalRequestChars: countMessageChars(chatMessages),
	};
}

/**
 * Convert VS Code tool definitions to the OpenAI `tools` payload.
 *
 * No count check happens here. An earlier build refused requests carrying more
 * than 128 tools, citing a constant that had been copied from the
 * `/provider/v1/chat/completions` limit — an endpoint the Go plan cannot use, and
 * never re-validated against the endpoint requests actually reach. Sending 127,
 * 128, 129, 150, 209 and 300 tools through the proxy all succeeded, so the
 * guard rejected only requests the vendor would have served. It also wasted
 * time: Copilot retried the same deterministic failure five times.
 */
function prepareTools(
	toolCallingCapability: boolean | number | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): ChatTool[] | undefined {
	if (!toolCallingCapability) {
		return undefined;
	}
	return convertTools(options.tools);
}

export type { ChatMessage };
