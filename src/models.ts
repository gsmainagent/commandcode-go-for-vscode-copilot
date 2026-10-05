import { FAMILY } from './consts';
import type { CatalogModel } from './catalog';
import { CONSERVATIVE_CAPABILITIES, measuredCapabilities } from './capabilities';
import { resolveTokenBudget } from './token-budget';
import type { ModelDefinition, ReasoningEffort, ThinkingCapability } from './types';

/**
 * Standard capability set for OpenAI-compatible reasoning models served by
 * Command Code: tool calling enabled, no native vision unless the underlying
 * model supports it (annotated per-entry below), and a 4-level thinking
 * effort selector.
 */
const THINKING: ThinkingCapability = {
	supportedEfforts: ['low', 'medium', 'high'] as const,
	defaultEffort: 'medium' as ReasoningEffort,
	canDisable: true,
};

const NO_THINKING = false;

/**
 * Window assumed when the plan page states none. Matches the smallest window in
 * the current Go plan.
 */
const FALLBACK_CONTEXT_LENGTH = 200000;

/**
 * Capabilities for a model discovered at runtime.
 *
 * A catalog id the probe never covered falls back to
 * `CONSERVATIVE_CAPABILITIES`, which reports no vision support: a model that
 * quietly ignores an image is a smaller failure than a text-only model being
 * handed image bytes that arrive as unreadable text.
 */
function liveCapabilities(modelId: string, catalog: CatalogModel): ModelDefinition['capabilities'] {
	// Precedence, strongest evidence first:
	//   1. the plan page's vendor declaration, fetched at runtime
	//   2. the compiled table in `capabilities.ts`, generated from the same page
	//   3. conservative defaults
	//
	// A vendor `false` is authoritative and must not be overridden by the
	// compiled table, so the two are checked separately rather than merged.
	const vendor =
		catalog.vision !== undefined || catalog.reasoning !== undefined
			? { vision: catalog.vision, reasoning: catalog.reasoning }
			: undefined;
	const measured = measuredCapabilities(modelId);
	const vision = vendor?.vision ?? measured?.vision ?? CONSERVATIVE_CAPABILITIES.vision;
	const reasoning = vendor?.reasoning ?? measured?.thinking ?? CONSERVATIVE_CAPABILITIES.thinking;

	return {
		toolCalling: true,
		imageInput: vision,
		thinking: reasoning ? THINKING : NO_THINKING,
	};
}

/**
 * Map a catalog id onto the static registry, tolerating the casing and vendor
 * prefix differences that accumulate between catalog releases
 * (`Qwen/Qwen3.7-Flash` vs `qwen/qwen3.7-flash`).
 */
function findStaticMatch(modelId: string): ModelDefinition | undefined {
	const exact = MODELS.find((model) => model.id === modelId);
	if (exact) {
		return exact;
	}
	const normalized = modelId.toLowerCase();
	return MODELS.find((model) => model.id.toLowerCase() === normalized);
}

/**
 * Build a picker definition for a catalog model.
 *
 * Capabilities resolve strongest-evidence-first: the live plan page's vendor
 * declaration, then the compiled table in `capabilities.ts` (generated from
 * that same page), then conservative defaults. A vendor `false` is
 * authoritative and is not overridden by the compiled table.
 *
 * Token budgets come from `resolveTokenBudget`, the same function the request
 * path uses, so the window Copilot is told about and the `max_tokens` actually
 * sent cannot disagree. `configuredMaxTokens` is the user's `maxTokens`
 * setting; it is passed in rather than read here so this module stays free of
 * the VS Code API.
 *
 * Static-registry entries keep only their curated display name and description.
 */
export function toModelDefinition(
	modelId: string,
	catalog: CatalogModel,
	configuredMaxTokens?: number,
): ModelDefinition {
	const staticMatch = findStaticMatch(modelId);
	const contextLength = catalog.contextLength > 0 ? catalog.contextLength : FALLBACK_CONTEXT_LENGTH;
	const version = modelId.slice(modelId.lastIndexOf('/') + 1) || 'live';
	const capabilities = liveCapabilities(modelId, catalog);
	// The model id is what selects the output ceiling: each model declares its
	// own, so a window alone cannot decide it.
	const budget = resolveTokenBudget(contextLength, configuredMaxTokens, modelId);
	// Plan-page metadata, carried through so the picker tooltip can show price
	// and intelligence. Omitted entirely when the page could not be read.
	const metadata = {
		...(catalog.pricing ? { pricing: catalog.pricing } : {}),
		...(catalog.intelligence !== undefined ? { intelligence: catalog.intelligence } : {}),
	};

	if (staticMatch) {
		return {
			...staticMatch,
			capabilities,
			maxInputTokens: budget.inputTokens,
			maxOutputTokens: budget.outputTokens,
			...metadata,
		};
	}

	return {
		id: modelId,
		name: catalog.name,
		family: FAMILY,
		version,
		// Left empty on purpose: the picker tooltip renders context length,
		// intelligence and price from the metadata fields below. Building a
		// localized sentence here would need the i18n module, which depends on
		// the VS Code API and cannot be unit-tested.
		detail: '',
		maxInputTokens: budget.inputTokens,
		maxOutputTokens: budget.outputTokens,
		capabilities,
		category: 'Live',
		fetched: true,
		...metadata,
	};
}

/**
 * Compile-time model registry — the seed and fallback for the picker.
 *
 * This is intentionally an allowlist rather than a copy of every upstream
 * model. Keep entries here aligned with the Go plan catalog so unsupported
 * models never appear in Copilot Chat's picker, and so the ones that do appear
 * carry accurate capability annotations. When `commandcode-copilot.modelSource`
 * is `dynamic` (the default) the live catalog supersedes this list; the registry
 * then only supplies names, descriptions, and capabilities for ids it knows.
 *
 * Each entry uses the upstream `vendor/name` slug from `cmdc --list-models`
 * as the model id, which is sent unchanged to the Generate API.
 *
 * Vision-capable models are flagged with `imageInput: true`. Tool calling
 * is assumed to be supported for every model — adjust per-entry if a
 * specific upstream omits it.
 *
 * Token windows: `maxInputTokens` is the upstream `context_length` (the
 * total window, input + output) minus `maxOutputTokens`, which is reserved
 * for generation. The live catalog overrides both values from
 * `GET <catalogBaseUrl>/models`, so this registry is the seed/fallback.
 */

export const MODELS: readonly ModelDefinition[] = [
	// ---- Alibaba ----
	{
		id: 'Qwen/Qwen3.6-Max-Preview',
		name: 'Qwen 3.6 Max Preview',
		family: FAMILY,
		version: '3.6',
		detail: 'vibe coding & efficient agent execution',
		maxInputTokens: 200000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'Alibaba',
	},
	{
		id: 'Qwen/Qwen3.6-Plus',
		name: 'Qwen 3.6 Plus',
		family: FAMILY,
		version: '3.6',
		detail: 'agentic coding & reasoning',
		maxInputTokens: 200000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Alibaba',
	},
	{
		id: 'Qwen/Qwen3.7-Flash',
		name: 'Qwen 3.7 Flash',
		family: FAMILY,
		version: '3.7',
		detail: 'fast low-cost agentic coding & reasoning',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Alibaba',
	},
	{
		id: 'Qwen/Qwen3.7-Max',
		name: 'Qwen 3.7 Max',
		family: FAMILY,
		version: '3.7',
		detail: 'frontier coding & long-horizon agent execution',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'Alibaba',
	},
	{
		id: 'Qwen/Qwen3.7-Plus',
		name: 'Qwen 3.7 Plus',
		family: FAMILY,
		version: '3.7',
		detail: 'agentic coding & reasoning at lower cost',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Alibaba',
	},
	{
		id: 'Qwen/Qwen3.8-Max',
		name: 'Qwen 3.8 Max',
		family: FAMILY,
		version: '3.8',
		detail: 'autonomous long-horizon coding & professional work',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Alibaba',
	},
	{
		id: 'Qwen/Qwen3.8-27B',
		name: 'Qwen 3.8 27B',
		family: FAMILY,
		version: '3.8',
		detail: 'cost-efficient 27B vision & reasoning',
		maxInputTokens: 262000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Alibaba',
	},

	// ---- DeepSeek ----
	{
		id: 'deepseek/deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		family: FAMILY,
		version: 'v4',
		detail: 'fast hybrid-attention reasoning',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'DeepSeek',
	},
	{
		id: 'deepseek/deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		family: FAMILY,
		version: 'v4',
		detail: 'hybrid-attention long-context reasoning',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'DeepSeek',
	},

	// ---- Meta ----
	{
		id: 'meta/muse-spark-1.2-contributor',
		name: 'Muse Spark 1.2 Contributor',
		family: FAMILY,
		version: '1.2',
		detail: 'Muse Spark 1.2 at ~95% off',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Meta',
	},

	// ---- MiniMax ----
	{
		id: 'MiniMaxAI/MiniMax-M2.5',
		name: 'MiniMax M2.5',
		family: FAMILY,
		version: 'm2.5',
		detail: 'cross-platform full-stack agentic dev',
		maxInputTokens: 200000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: NO_THINKING },
		category: 'MiniMax',
	},
	{
		id: 'MiniMaxAI/MiniMax-M2.7',
		name: 'MiniMax M2.7',
		family: FAMILY,
		version: 'm2.7',
		detail: 'end-to-end software engineering agent',
		maxInputTokens: 200000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: NO_THINKING },
		category: 'MiniMax',
	},
	{
		id: 'MiniMaxAI/MiniMax-M3',
		name: 'MiniMax M3',
		family: FAMILY,
		version: 'm3',
		detail: 'frontier coding, agents & native multimodality',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'MiniMax',
	},

	// ---- Moonshot AI ----
	{
		id: 'moonshotai/Kimi-K2.5',
		name: 'Kimi K2.5',
		family: FAMILY,
		version: 'k2.5',
		detail: 'multimodal frontend coding',
		maxInputTokens: 256000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: NO_THINKING },
		category: 'Moonshot AI',
	},
	{
		id: 'moonshotai/Kimi-K2.6',
		name: 'Kimi K2.6',
		family: FAMILY,
		version: 'k2.6',
		detail: 'long-horizon coding with vision',
		maxInputTokens: 256000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: NO_THINKING },
		category: 'Moonshot AI',
	},
	{
		id: 'moonshotai/Kimi-K2.7-Code',
		name: 'Kimi K2.7 Code',
		family: FAMILY,
		version: 'k2.7',
		detail: 'improved long-horizon coding with vision',
		maxInputTokens: 256000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Moonshot AI',
	},
	{
		id: 'moonshotai/Kimi-K2.7-Code-Highspeed',
		name: 'Kimi K2.7 Code HighSpeed',
		family: FAMILY,
		version: 'k2.7',
		detail: 'high-speed long-horizon coding with vision',
		maxInputTokens: 262000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Moonshot AI',
	},
	{
		id: 'moonshotai/Kimi-K3',
		name: 'Kimi K3',
		family: FAMILY,
		version: 'k3',
		detail: 'long-horizon coding & knowledge work with 1M context',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Moonshot AI',
	},

	// ---- NVIDIA ----
	{
		id: 'nvidia/nemotron-3-ultra-550b-a55b',
		name: 'Nemotron 3 Ultra',
		family: FAMILY,
		version: '3',
		detail: 'open reasoning model for long-horizon autonomous agents',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'NVIDIA',
	},

	// ---- OpenAI ----
	{
		id: 'gpt-5.6-luna',
		name: 'GPT-5.6 Luna',
		family: FAMILY,
		version: '5.6',
		detail: 'optimized for cost-sensitive workloads',
		maxInputTokens: 1100000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'OpenAI',
	},
	// ---- Poolside ----
	{
		id: 'poolside/laguna-s-2.1-free',
		name: 'Laguna S 2.1',
		family: FAMILY,
		version: '2.1',
		detail: 'open-weight agentic coding and long-horizon work',
		maxInputTokens: 256000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'Poolside',
	},

	// ---- StepFun ----
	{
		id: 'stepfun/Step-3.5-Flash',
		name: 'Step 3.5 Flash',
		family: FAMILY,
		version: '3.5',
		detail: 'fast sparse-MoE agentic reasoning',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'StepFun',
	},
	{
		id: 'stepfun/Step-3.7-Flash',
		name: 'Step 3.7 Flash',
		family: FAMILY,
		version: '3.7',
		detail: 'multimodal sparse-MoE reasoning',
		maxInputTokens: 256000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'StepFun',
	},

	// ---- Tencent ----
	{
		id: 'tencent/hy3-paid',
		name: 'Tencent Hy3',
		family: FAMILY,
		version: 'hy3',
		detail: 'sparse-MoE reasoning & agentic tool use',
		maxInputTokens: 262000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'Tencent',
	},

	// ---- Thinking Machines ----
	{
		id: 'thinkingmachines/inkling',
		name: 'Inkling',
		family: FAMILY,
		version: 'inkling',
		detail: 'multimodal MoE reasoning',
		maxInputTokens: 256000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Thinking Machines',
	},
	{
		id: 'thinkingmachines/inkling-small',
		name: 'Inkling Small',
		family: FAMILY,
		version: 'inkling',
		detail: 'lightweight MoE reasoning at lower cost and latency',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'Thinking Machines',
	},

	// ---- xAI ----
	{
		id: 'xai/grok-4.5',
		name: 'Grok 4.5',
		family: FAMILY,
		version: '4.5',
		detail: 'smartest model for coding, agentic tasks, knowledge work',
		maxInputTokens: 500000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: THINKING },
		category: 'xAI',
	},
	// ---- Xiaomi ----
	{
		id: 'xiaomi/mimo-v2.5',
		name: 'MiMo V2.5',
		family: FAMILY,
		version: 'v2.5',
		detail: 'efficient long-context agentic coding',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: true, thinking: NO_THINKING },
		category: 'Xiaomi',
	},
	{
		id: 'xiaomi/mimo-v2.5-pro',
		name: 'MiMo V2.5 Pro',
		family: FAMILY,
		version: 'v2.5',
		detail: 'high-capability long-context agentic coding',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: NO_THINKING },
		category: 'Xiaomi',
	},

	// ---- Z AI ----
	{
		id: 'zai-org/GLM-5',
		name: 'GLM-5',
		family: FAMILY,
		version: '5',
		detail: 'multi-mode thinking & long-range planning',
		maxInputTokens: 200000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: NO_THINKING },
		category: 'Z AI',
	},
	{
		id: 'zai-org/GLM-5.1',
		name: 'GLM-5.1',
		family: FAMILY,
		version: '5.1',
		detail: 'long-horizon autonomous coding agent',
		maxInputTokens: 200000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: NO_THINKING },
		category: 'Z AI',
	},
	{
		id: 'zai-org/GLM-5.2',
		name: 'GLM-5.2',
		family: FAMILY,
		version: '5.2',
		detail: 'powerful coding with 1M context and long-horizon tasks',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'Z AI',
	},
	{
		id: 'zai-org/GLM-5.2-Fast',
		name: 'GLM-5.2 Fast',
		family: FAMILY,
		version: '5.2',
		detail: 'high-throughput GLM-5.2 with 1M context',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: NO_THINKING },
		category: 'Z AI',
	},
	{
		id: 'zai-org/GLM-5.3',
		name: 'GLM-5.3',
		family: FAMILY,
		version: '5.3',
		detail: 'frontier coding with 1M context',
		maxInputTokens: 1000000,
		maxOutputTokens: 32000,
		capabilities: { toolCalling: true, imageInput: false, thinking: THINKING },
		category: 'Z AI',
	},
];
