/**
 * The single source of truth for token budgets.
 *
 * Both numbers reported to Copilot Chat (`maxInputTokens` / `maxOutputTokens`)
 * and the number sent upstream (`params.max_tokens`) are derived here, so the
 * reported value and the sent value cannot drift apart.
 *
 * ## The ceiling is per model, not one number
 *
 * The endpoint accepts `max_tokens` up to 200000, but each model declares its own
 * ceiling and refuses anything higher with a deterministic 400:
 *
 *     `Range of max_tokens should be [1, 131072]`
 *
 * Sending one constant for the whole catalog broke the models whose ceiling was
 * lower, and the refusal was then retried as if it were transient. The effective
 * limit is therefore `min(endpoint ceiling, the model's own)`, resolved by
 * `outputCeilingFor` — see `output-ceiling.ts` for the measurements and for why
 * an unmeasured model defaults to the lowest confirmed value rather than the
 * highest.
 *
 * ## Why a model's context window is not the output budget
 *
 * The window describes input and output *together*. Kimi K3 reports 1M, and
 * sending `max_tokens: 1000000` for it is refused outright. So the window is split,
 * never used whole for output.
 */
import { DEFAULT_OUTPUT_CEILING, outputCeilingFor } from './output-ceiling';

export interface TokenBudget {
	/** Output cap reported to Copilot and sent as `params.max_tokens`. */
	readonly outputTokens: number;
	/**
	 * Input window reported to Copilot.
	 *
	 * The remainder after reserving the output budget, because the total window
	 * covers both. Reporting the full window for input *and* the full window for
	 * output would double the model's real capacity.
	 */
	readonly inputTokens: number;
}

/**
 * Share of a model's window reserved for generation when the model's own ceiling
 * does not already decide the split.
 *
 * Without it a small-window model would spend its whole window on output:
 * a 175K model would report `maxOutputTokens: 175000` and
 * `maxInputTokens: 1`, leaving Copilot no room to send the conversation. Models
 * with a window of 800000 or more are already bounded by their output ceiling, so
 * this share does not apply to them.
 */
const OUTPUT_SHARE = 0.25;

/** Floor for the output budget, so a tiny model is not left unable to reply. */
const MIN_OUTPUT_TOKENS = 8_192;

/**
 * Split a model's total context window into input and output budgets.
 *
 * The output budget is as large as the model itself permits: its own measured
 * ceiling whenever the window is big enough to allow it, otherwise a quarter of
 * the window so input keeps the majority.
 *
 * `configuredMaxTokens` raises the output budget when the user set one, but
 * cannot exceed the model's ceiling. Input always absorbs the remainder, so input
 * plus output never exceeds the model's real total window.
 *
 * `modelId` is what selects the ceiling. Omitting it is safe rather than
 * dangerous: the default is the lowest ceiling any model was measured to accept,
 * so an unrecognised model gets a value the whole measured set already tolerates.
 */
export function resolveTokenBudget(
	contextLength: number,
	configuredMaxTokens?: number,
	modelId?: string,
): TokenBudget {
	const ceiling = modelId ? outputCeilingFor(modelId) : DEFAULT_OUTPUT_CEILING;

	// With no stated window there is nothing to split, so the ceiling stands in
	// for the total and the usual share applies to it.
	const total = contextLength > 0 ? contextLength : ceiling;

	const defaultShare = Math.floor(total * OUTPUT_SHARE);
	const wanted =
		configuredMaxTokens !== undefined && configuredMaxTokens > 0
			? configuredMaxTokens
			: Math.max(MIN_OUTPUT_TOKENS, defaultShare);

	const outputTokens = Math.max(1, Math.min(wanted, total, ceiling));

	return {
		outputTokens,
		inputTokens: Math.max(1, total - outputTokens),
	};
}
