import vscode from 'vscode';
import { streamChatCompletion as proxyStream } from '../client/proxy-client';
import { logger } from '../logger';
import type { ChatToolCall, ChatUsage } from '../types';
import type { PreparedChatRequest } from './request';

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

export interface StreamChatCompletionOptions {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
}

export function streamChatCompletion({
	prepared,
	progress,
	token,
	getCharsPerToken,
	setCharsPerToken,
}: StreamChatCompletionOptions): Promise<void> {
	return proxyStream(
		prepared.proxy,
		prepared.request,
		{
			onContent: (content: string) => {
				progress.report(new vscode.LanguageModelTextPart(content));
			},

			onThinking: (text: string) => {
				progress.report(
					new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart,
				);
			},

			onToolCall: (toolCall: ChatToolCall) => {
				try {
					const args = JSON.parse(toolCall.function.arguments);
					progress.report(
						new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
					);
				} catch {
					progress.report(
						new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {}),
					);
				}
			},

			// Throwing here rejects the returned promise, which is how Copilot Chat
			// receives the failure. The proxy client has already mapped it to a
			// user-facing error, so it is rethrown as-is rather than wrapped twice.
			onError: (error: Error) => {
				throw error;
			},

			onUsage: (usage: ChatUsage) => {
				const charsPerToken = updateCharsPerToken(
					prepared.totalRequestChars,
					usage,
					getCharsPerToken(),
				);
				setCharsPerToken(charsPerToken);
				reportCopilotUsage(progress, usage);
			},
		},
		token,
	);
}

function updateCharsPerToken(
	totalRequestChars: number,
	usage: ChatUsage,
	charsPerToken: number,
): number {
	if (totalRequestChars > 0 && usage.prompt_tokens > 0) {
		const observedRatio = totalRequestChars / usage.prompt_tokens;
		return charsPerToken * 0.7 + observedRatio * 0.3;
	}
	return charsPerToken;
}

function reportCopilotUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	usage: ChatUsage,
): void {
	const data = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		prompt_tokens_details: {
			cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
		},
	};

	try {
		progress.report(
			new vscode.LanguageModelDataPart(
				new TextEncoder().encode(JSON.stringify(data)),
				COPILOT_USAGE_DATA_PART_MIME,
			),
		);
	} catch (error) {
		logger.warn('Failed to report Command Code usage', error);
	}
}
