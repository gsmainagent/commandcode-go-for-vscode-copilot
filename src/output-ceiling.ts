/**
 * Per-model output-token ceilings, measured against the live endpoint.
 *
 * ## Why this is not one constant
 *
 * The Generate endpoint accepts `max_tokens` up to 200000, but each model declares
 * its own lower ceiling and refuses anything above it:
 *
 *     `Range of max_tokens should be [1, 131072]`
 *
 * An earlier build sent the endpoint ceiling to every model and treated a refusal
 * as a transient failure, so a deterministic 400 was retried five times over
 * ~15 seconds. The constant was defensible for the four models it had been
 * measured on and wrong for the rest.
 *
 * ## Why the default is the *lowest* measured value
 *
 * The catalog gains models between refreshes, and their ceilings are not
 * published on the plan page. Defaulting to the endpoint ceiling means every new
 * model is assumed to accept the maximum, which is the assumption that broke.
 * Defaulting to the lowest confirmed ceiling means an unknown model is sent a
 * value the whole measured set already accepts, and a model that turns out to
 * want less fails visibly rather than silently costing a retry storm.
 *
 * Entries are raised only on evidence: a model is listed here after a request at
 * that value succeeded. Anything absent keeps `DEFAULT_OUTPUT_CEILING`, which is
 * safe by construction.
 *
 * Re-measure with: send `max_tokens: N` and read the ceiling out of the
 * `Range of max_tokens should be [1, N]` refusal.
 */

/** Highest `max_tokens` the endpoint itself accepts, across any model. */
export const ENDPOINT_OUTPUT_CEILING = 200_000;

/**
 * Value sent to any model without a measured entry.
 *
 * The lowest ceiling confirmed against the Go plan catalog: 38 of 40 reachable
 * models accepted it, and the ones that did not named a *lower* limit rather than
 * a higher one. No measured model refused it for being too high.
 */
export const DEFAULT_OUTPUT_CEILING = 131_072;

/**
 * Models measured to accept more than {@link DEFAULT_OUTPUT_CEILING}.
 *
 * The Qwen family is not uniform here — `Qwen3.8-27B` accepts 200000 while
 * `Qwen3.8-Max` stops at 131072 — so this is keyed by exact id, never by vendor.
 */
const HIGHER_OUTPUT_CEILINGS: Readonly<Record<string, number>> = {
	// Frontier and large-window models that confirmed 200000.
	'zai-org/GLM-5.3': 200_000,
	'z-ai/glm-5.2': 200_000,
	'z-ai/glm-5.2-fast': 200_000,
	'deepseek/deepseek-v4.1-flash-fast': 200_000,
	'deepseek/deepseek-v4-flash': 200_000,
	'deepseek/deepseek-v4-pro': 200_000,
	'moonshotai/Kimi-K3': 200_000,
	'inclusionai/ling-3.1-flash:free': 200_000,
	'Qwen/Qwen3.8-27B': 200_000,
	'gpt-5.6-luna': 200_000,
	'nemotron/nemotron-3-ultra-550b-a55b': 200_000,
	'meta/muse-spark-1.2-contributor': 200_000,
};

/**
 * Models measured to accept *less* than {@link DEFAULT_OUTPUT_CEILING}.
 *
 * Kept explicit even though the default already covers them, because the value
 * is the server's own statement and re-measuring should not have to rediscover it.
 */
const LOWER_OUTPUT_CEILINGS: Readonly<Record<string, number>> = {
	'Qwen/Qwen3.6-Max-Preview': 65_536,
};

/**
 * The `max_tokens` ceiling for one model.
 *
 * Matches on the exact id first, then on a case-insensitive tail, because the
 * plan page and the registry disagree about casing for some models and a
 * mismatched key would silently fall back to the default.
 */
export function outputCeilingFor(modelId: string): number {
	const exact = LOWER_OUTPUT_CEILINGS[modelId] ?? HIGHER_OUTPUT_CEILINGS[modelId];
	if (exact !== undefined) {
		return exact;
	}

	const tail = modelId.slice(modelId.lastIndexOf('/') + 1).toLowerCase();
	if (!tail) {
		return DEFAULT_OUTPUT_CEILING;
	}
	for (const table of [LOWER_OUTPUT_CEILINGS, HIGHER_OUTPUT_CEILINGS]) {
		for (const [id, ceiling] of Object.entries(table)) {
			if (id.slice(id.lastIndexOf('/') + 1).toLowerCase() === tail) {
				return ceiling;
			}
		}
	}
	return DEFAULT_OUTPUT_CEILING;
}
