/**
 * Shared types for the Command Code Go for vscode extension.
 */

// ---- API request/response types ----

/**
 * Reasoning effort values supported by the picker.
 *
 * `none` means "do not send any reasoning parameters" — the model runs in its
 * default non-thinking mode. `low` / `medium` / `high` map directly onto the
 * OpenAI-compatible `reasoning_effort` field for models that advertise
 * reasoning capability.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export type ThinkingEffort = 'none' | ReasoningEffort;

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
	role: ChatRole;
	/**
	 * Message content.
	 *
	 * A string for text-only messages; an array for user messages carrying
	 * images, because that is the OpenAI shape the proxy accepts on the wire.
	 * The array form is only ever produced for vision input, so callers that
	 * expect text must read `content` defensively rather than assuming a string.
	 */
	content: string | ChatMessagePart[];
	tool_call_id?: string;
	tool_calls?: ChatToolCall[];
	reasoning_content?: string;
	/** Optional multimodal content for user messages (vision input). */
	parts?: ChatMessagePart[];
}

export type ChatMessagePart =
	| { type: 'text'; text: string }
	| {
			type: 'image_url';
			image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
	  };

export interface ChatToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface ChatUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: ChatToolCall) => void;
	onError: (error: Error) => void;
	onDone?: () => void;
	onUsage?: (usage: ChatUsage) => void;
}

// ---- Model registry ----

export interface ThinkingCapability {
	/** Effort values that appear in the model picker dropdown. */
	supportedEfforts: readonly ReasoningEffort[];
	defaultEffort: ReasoningEffort;
	/** When true, `none` is offered alongside the configured efforts. */
	canDisable: boolean;
}

/**
 * Prices in USD per million tokens, as stated by the plan page.
 *
 * `input` / `output` / `cacheRead` / `cacheWrite` are the off-peak rates the page
 * displays. The `peak*` figures come from the same cell's `aria-label`, which
 * spells out the higher rate and the window it applies to.
 *
 * A model priced at zero is free (`input === 0`), not unknown — unknown is
 * `undefined`.
 */
export interface PlanPricing {
	readonly input: number | undefined;
	readonly output: number | undefined;
	readonly cacheRead: number | undefined;
	readonly cacheWrite: number | undefined;
	/** Peak-hour input rate, when the page states one. */
	readonly peakInput?: number;
	/** Peak-hour output rate, when the page states one. */
	readonly peakOutput?: number;
	/** Peak-hour cache-read rate, when the page states one. */
	readonly peakCacheRead?: number;
	/** Peak window verbatim, e.g. `01–04 & 06–10 UTC, Mon–Fri`. */
	readonly peakWindow?: string;
	/** Hours per day billed at off-peak rates, e.g. 17 for `17h/day`. */
	readonly offPeakHoursPerDay?: number;
}

export interface ModelDefinition {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: {
		/** `false` disables tools; a number limits tools per request. */
		toolCalling: boolean | number;
		imageInput: boolean;
		thinking: ThinkingCapability | false;
	};
	/** Optional category used to group models in logs/UI. */
	category?: string;
	/**
	 * Plan-page metadata, when the docs page supplied it.
	 *
	 * Absent when the plan page could not be read and nothing was cached, which
	 * is why every field here is optional. The picker degrades to showing only
	 * what the API catalog states rather than inventing figures.
	 */
	pricing?: PlanPricing;
	/** The plan page's `Intelligence` index score. */
	intelligence?: number;
	/**
	 * True when the model came from the plan page rather than the curated
	 * registry in `models.ts`. Fetched entries surface the upstream model id in
	 * the picker tooltip.
	 */
	fetched?: boolean;
}

/**
 * One entry from `GET /provider/v1/models`.
 *
 * Only `id` is read: the catalog exists solely to supply canonical model ids,
 * because the plan page names models by slug (`kimi-k3`) while the Generate API
 * expects `moonshotai/Kimi-K3`. Names, windows, and capabilities all come from
 * the plan page instead.
 */
export interface ApiModelInfo {
	id?: string;
	owned_by?: string;
	/** Human-readable name; present on the official catalog endpoint. */
	name?: string;
	/** Total context window (input + output) in tokens, when advertised. */
	context_length?: number;
	/** Unix seconds, as served. Unused today but part of the shape. */
	created?: number;
	/** Wire protocols this model is served on, e.g. `/chat/completions`. */
	supported_endpoints?: string[];
}
