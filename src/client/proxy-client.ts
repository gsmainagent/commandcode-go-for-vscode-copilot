/**
 * Streaming client for the vendored `commandcode-proxy`.
 *
 * ## Why this speaks OpenAI
 *
 * The proxy exposes `/v1/chat/completions`, so the wire format is OpenAI's. That
 * makes the extension's existing OpenAI-shaped intermediate representation the
 * actual wire format rather than a staging step on the way to a proprietary one,
 * so the second conversion hop — OpenAI intermediate to the AI SDK envelope,
 * with its `{ type: 'text' }` part arrays and `tool-call` parts — is gone.
 *
 * ## What the proxy handles upstream
 *
 * The request envelope (`config`, `memory`, `taste`, `skills`, `threadId`), the
 * device fingerprint, the lifecycle preflight, and the always-stream requirement
 * on Go plans. It builds those itself; this module only sends OpenAI-shaped
 * input and reads OpenAI-shaped output.
 *
 * Note that the proxy also *constructs* `config`, from a spoofed device profile
 * rather than the real workspace. The local working directory, git branch, git
 * status and recent commits are not sent upstream. That is deliberate on its
 * part — a real cwd and commit messages are a strong fingerprint — and it means
 * the model no longer sees local git context.
 */

import type { CancellationToken } from 'vscode';
import type { ChatMessage, ChatToolCall, ChatUsage, StreamCallbacks } from '../types';
import { createUserFacingError } from './error';

export interface ProxyRequest {
	readonly model: string;
	readonly messages: readonly ChatMessage[];
	readonly tools?: readonly OpenAITool[];
	readonly maxTokens: number;
	readonly temperature: number;
	readonly reasoningEffort?: 'low' | 'medium' | 'high';
}

/** OpenAI function-tool shape, which the proxy accepts verbatim. */
export interface OpenAITool {
	readonly type: 'function';
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: Record<string, unknown>;
	};
}

export interface ProxyClientOptions {
	/** `http://127.0.0.1:<port>/v1` from `ensureProxy`. */
	readonly baseUrl: string;
	/**
	 * The user's Command Code key.
	 *
	 * Sent per request because the proxy does not store it. It therefore travels
	 * only to the loopback child process, never to a file.
	 */
	readonly apiKey: string;
	/** Attach `x-cmd-zdr: 1` so the proxy requests zero-data-retention routing. */
	readonly zeroDataRetention?: boolean;
	readonly debug?: boolean;
}

/** One OpenAI SSE chunk, as far as this client cares. */
interface ChatCompletionChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			reasoning_content?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number };
	};
	error?: { message?: string; type?: string };
}

/**
 * Send one streaming chat completion and drive the callbacks as it arrives.
 *
 * Never throws for an upstream failure: errors reach `onError`, matching how the
 * provider reports them to Copilot Chat.
 */
export async function streamChatCompletion(
	options: ProxyClientOptions,
	request: ProxyRequest,
	callbacks: StreamCallbacks,
	token?: CancellationToken,
): Promise<void> {
	const controller = new AbortController();
	const cancel = token?.onCancellationRequested(() => controller.abort());
	if (token?.isCancellationRequested) {
		controller.abort();
	}

	// OpenAI tool-call deltas arrive in fragments keyed by `index`, not by id: the
	// id and name come with the first fragment and the arguments accumulate across
	// many. Reassembling per index is the only correct way to read this format.
	const pending = new Map<number, ChatToolCall & { id?: string }>();

	const flush = (): void => {
		for (const call of pending.values()) {
			callbacks.onToolCall(call);
		}
		pending.clear();
	};

	try {
		const response = await fetch(`${options.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${options.apiKey}`,
				...(options.zeroDataRetention ? { 'x-cmd-zdr': '1' } : {}),
			},
			body: JSON.stringify({
				model: request.model,
				messages: request.messages,
				max_tokens: request.maxTokens,
				temperature: request.temperature,
				stream: true,
				stream_options: { include_usage: true },
				...(request.tools?.length ? { tools: request.tools } : {}),
				...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw await readHttpError(response);
		}
		if (!response.body) {
			throw new Error('the proxy returned no response body');
		}

		const usage = await consume(response.body, callbacks, pending, token, controller);

		// Usage arrives last, after the stream ends, so tool calls are flushed
		// first: a provider would otherwise receive the tool call after the
		// response was already reported complete.
		flush();
		if (usage) {
			callbacks.onUsage?.(usage);
		}
		callbacks.onDone?.();
	} catch (error) {
		if (isAbort(error) && token?.isCancellationRequested) {
			return;
		}
		callbacks.onError(createUserFacingError(asError(error)));
	} finally {
		cancel?.dispose();
	}
}

async function consume(
	body: ReadableStream<Uint8Array>,
	callbacks: StreamCallbacks,
	pending: Map<number, ChatToolCall & { id?: string }>,
	token: CancellationToken | undefined,
	controller: AbortController,
): Promise<ChatUsage | undefined> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let usage: ChatUsage | undefined;
	let streamError: string | undefined;

	while (true) {
		if (token?.isCancellationRequested) {
			controller.abort();
			return undefined;
		}

		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });

		// SSE frames are separated by a blank line. The remainder after the last
		// separator is a partial frame and must stay buffered.
		const frames = buffer.split(/\r?\n\r?\n/);
		buffer = frames.pop() ?? '';

		for (const frame of frames) {
			for (const payload of readDataPayloads(frame)) {
				const chunk = parseChunk(payload);
				if (!chunk) {
					continue;
				}
				if (chunk.error) {
					streamError = chunk.error.message ?? 'the proxy reported an error';
					continue;
				}
				const mapped = chunk.usage ? toChatUsage(chunk.usage) : undefined;
				if (mapped) {
					usage = mapped;
				}
				applyDelta(chunk, callbacks, pending);
			}
		}

		if (streamError) {
			await reader.cancel().catch(() => {});
			throw new Error(streamError);
		}
	}

	// A frame may arrive without a trailing blank line.
	if (buffer.trim()) {
		for (const payload of readDataPayloads(buffer)) {
			const chunk = parseChunk(payload);
			if (chunk?.usage) {
				usage = toChatUsage(chunk.usage) ?? usage;
			}
		}
	}

	return usage;
}

function readDataPayloads(frame: string): string[] {
	const payloads: string[] = [];
	for (const line of frame.split(/\r?\n/)) {
		if (!line.startsWith('data:')) {
			continue;
		}
		const payload = line.slice(5).trim();
		if (payload && payload !== '[DONE]') {
			payloads.push(payload);
		}
	}
	return payloads;
}

function parseChunk(payload: string): ChatCompletionChunk | undefined {
	try {
		return JSON.parse(payload) as ChatCompletionChunk;
	} catch {
		// A partial or non-JSON frame is not worth failing the whole response over.
		return undefined;
	}
}

function applyDelta(
	chunk: ChatCompletionChunk,
	callbacks: StreamCallbacks,
	pending: Map<number, ChatToolCall & { id?: string }>,
): void {
	const delta = chunk.choices?.[0]?.delta;
	if (!delta) {
		return;
	}

	// Reasoning arrives on its own channel and must be reported as thinking, not
	// as answer text.
	if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
		callbacks.onThinking(delta.reasoning_content);
	}
	if (typeof delta.content === 'string' && delta.content) {
		callbacks.onContent(delta.content);
	}

	for (const fragment of delta.tool_calls ?? []) {
		const index = fragment.index ?? 0;
		let call = pending.get(index);
		if (!call) {
			call = {
				id: fragment.id ?? `call_${index}`,
				type: 'function',
				function: { name: fragment.function?.name ?? '', arguments: '' },
			};
			pending.set(index, call);
		} else if (fragment.id) {
			call.id = fragment.id;
		}
		// Arguments accumulate across fragments; the name does not. The proxy
		// repeats it on more than one delta, so appending would yield
		// `get_weatherget_weather` and Copilot would call a tool that does not
		// exist. A later fragment may only fill a name the first one omitted.
		if (fragment.function?.name && !call.function.name) {
			call.function.name = fragment.function.name;
		}
		if (fragment.function?.arguments) {
			call.function.arguments += fragment.function.arguments;
		}
	}
}

function toChatUsage(raw: NonNullable<ChatCompletionChunk['usage']>): ChatUsage {
	const prompt = raw.prompt_tokens ?? 0;
	const completion = raw.completion_tokens ?? 0;
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: raw.total_tokens ?? prompt + completion,
		prompt_cache_hit_tokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
	};
}

/**
 * Turn a proxy HTTP failure into a message worth showing.
 *
 * The proxy relays upstream errors in the OpenAI error shape, so the useful text
 * is usually nested one or two levels down.
 */
async function readHttpError(response: Response): Promise<Error> {
	const text = await response.text().catch(() => '');
	let message = text.slice(0, 400);
	try {
		const parsed = JSON.parse(text) as {
			error?: { message?: string } | string;
			message?: string;
		};
		if (typeof parsed.error === 'string') {
			message = parsed.error;
		} else if (parsed.error?.message) {
			message = parsed.error.message;
		} else if (parsed.message) {
			message = parsed.message;
		}
	} catch {
		// Not JSON; the raw text is the best available.
	}
	return new Error(`HTTP ${response.status}: ${message}`);
}

function isAbort(error: unknown): boolean {
	return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
