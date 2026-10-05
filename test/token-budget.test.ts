import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveTokenBudget } from '../src/token-budget';
import {
	DEFAULT_OUTPUT_CEILING,
	ENDPOINT_OUTPUT_CEILING,
	outputCeilingFor,
} from '../src/output-ceiling';

/**
 * The number reported to Copilot and the number sent as `max_tokens` come from
 * this one function, so these cases pin both the endpoint ceiling discovered by
 * probing and the no-double-counting rule.
 */

describe('resolveTokenBudget: per-model ceiling', () => {
	// The endpoint accepts 200000, but each model declares its own ceiling and
	// refuses anything above it with a deterministic 400. A single constant for
	// the catalog broke exactly the models whose ceiling was lower.
	it('clamps a model whose ceiling is below the endpoint maximum', () => {
		// `Qwen/Qwen3.6-Max-Preview` states `Range of max_tokens should be [1, 65536]`.
		const budget = resolveTokenBudget(1_100_000, undefined, 'Qwen/Qwen3.6-Max-Preview');
		assert.equal(budget.outputTokens, 65_536);
		assert.ok(budget.outputTokens <= ENDPOINT_OUTPUT_CEILING);
	});

	it('uses the endpoint ceiling for a model measured to accept it', () => {
		const budget = resolveTokenBudget(1_100_000, undefined, 'zai-org/GLM-5.3');
		assert.equal(budget.outputTokens, ENDPOINT_OUTPUT_CEILING);
	});

	// An unmeasured model must not be assumed to accept the maximum: the catalog
	// gains models between refreshes and their ceilings are not published.
	it('defaults an unmeasured model to the lowest confirmed ceiling', () => {
		for (const id of ['vendor/brand-new-model', 'gpt-6-luna', 'weird/unknown-id']) {
			const budget = resolveTokenBudget(1_100_000, undefined, id);
			assert.equal(
				budget.outputTokens,
				DEFAULT_OUTPUT_CEILING,
				`${id} was raised without evidence`,
			);
		}
	});

	it('never sends more than the endpoint accepts, for any model', () => {
		for (const id of [
			'Qwen/Qwen3.6-Max-Preview',
			'Qwen/Qwen3.8-Max',
			'zai-org/GLM-5.3',
			'unknown/model',
		]) {
			const budget = resolveTokenBudget(1_100_000, undefined, id);
			assert.ok(
				budget.outputTokens <= ENDPOINT_OUTPUT_CEILING,
				`${id} was sent ${budget.outputTokens}, above the endpoint ceiling`,
			);
		}
	});

	it('clamps an explicit setting to the model ceiling', () => {
		assert.equal(
			resolveTokenBudget(1_000_000, 5_000_000, 'Qwen/Qwen3.6-Max-Preview').outputTokens,
			65_536,
		);
		assert.equal(
			resolveTokenBudget(1_000_000, 5_000_000, 'zai-org/GLM-5.3').outputTokens,
			ENDPOINT_OUTPUT_CEILING,
		);
	});

	it('omitting the model id is safe rather than dangerous', () => {
		// Callers that cannot name a model get the lowest confirmed ceiling, which
		// every measured model already accepts.
		const budget = resolveTokenBudget(1_100_000);
		assert.equal(budget.outputTokens, DEFAULT_OUTPUT_CEILING);
	});

	// The budget and the ceiling table must not disagree: the number reported to
	// Copilot is what gets sent, so a mismatch here is a silent drift between the
	// two halves of the same promise.
	it('never exceeds the ceiling the table reports for that model', () => {
		for (const id of [
			'Qwen/Qwen3.6-Max-Preview',
			'Qwen/Qwen3.8-Max',
			'Qwen/Qwen3.8-27B',
			'zai-org/GLM-5.3',
			'unknown/model',
		]) {
			for (const window of [1_100_000, 1_000_000, 262_000, 175_000]) {
				const budget = resolveTokenBudget(window, undefined, id);
				assert.ok(
					budget.outputTokens <= outputCeilingFor(id),
					`${id} @ ${window}: sent ${budget.outputTokens}, ceiling is ${outputCeilingFor(id)}`,
				);
			}
		}
	});
});

describe('resolveTokenBudget: window split', () => {
	it('never double-counts input and output against the window', () => {
		// Reporting the full window for both would claim 2M of capacity for a
		// model that has 1M.
		for (const window of [1_000_000, 1_100_000, 262_000, 175_000, 230_000, 968_000]) {
			const budget = resolveTokenBudget(window);
			assert.equal(
				budget.inputTokens + budget.outputTokens,
				window,
				`input + output should equal the ${window} window`,
			);
		}
	});

	it('keeps input usable on a small window', () => {
		// Without a share, a 175K model would reserve 175000 for output and report
		// maxInputTokens: 1, leaving Copilot no room for the conversation.
		const budget = resolveTokenBudget(175_000);
		assert.ok(budget.inputTokens > 0);
		assert.ok(
			budget.inputTokens >= budget.outputTokens,
			'input should hold at least as much as output',
		);
	});

	it('still gives a large window the full model ceiling', () => {
		const budget = resolveTokenBudget(1_000_000, undefined, 'moonshotai/Kimi-K3');
		assert.equal(budget.outputTokens, ENDPOINT_OUTPUT_CEILING);
		assert.equal(budget.inputTokens, 1_000_000 - ENDPOINT_OUTPUT_CEILING);
	});

	it('scales output with the window when the ceiling does not bind', () => {
		const budget = resolveTokenBudget(400_000);
		assert.equal(budget.outputTokens, 100_000, 'a quarter of the window');
		assert.equal(budget.inputTokens, 300_000);
	});

	it('gives every model room to reply', () => {
		for (const window of [32_000, 64_000, 128_000, 175_000, 200_000, 262_000]) {
			const budget = resolveTokenBudget(window);
			assert.ok(
				budget.outputTokens >= 8_192,
				`${window} window leaves only ${budget.outputTokens} output tokens`,
			);
			assert.ok(budget.inputTokens >= 1, `${window} window leaves no input room`);
		}
	});
});

describe('resolveTokenBudget: configuration and degenerate input', () => {
	it('honours an explicit setting and rebalances input', () => {
		const budget = resolveTokenBudget(1_000_000, 50_000);
		assert.equal(budget.outputTokens, 50_000);
		assert.equal(budget.inputTokens, 950_000, 'input absorbs the smaller output share');
	});

	it('ignores a zero or negative setting', () => {
		const fromZero = resolveTokenBudget(1_000_000, 0);
		const fromNone = resolveTokenBudget(1_000_000);
		assert.deepEqual(fromZero, fromNone);
		assert.deepEqual(resolveTokenBudget(1_000_000, -5), fromNone);
	});

	// With no window stated there is nothing to split, so the endpoint ceiling
	// stands in for the total and the usual share applies to it.
	it('treats the model ceiling as the window when none is known', () => {
		const budget = resolveTokenBudget(0, undefined, 'zai-org/GLM-5.3');
		assert.equal(budget.inputTokens + budget.outputTokens, ENDPOINT_OUTPUT_CEILING);
		assert.ok(budget.outputTokens > 0);
		assert.ok(budget.inputTokens > 0);
	});

	it('never returns a zero budget for any input', () => {
		for (const window of [0, 1, 2, 8_191, 8_192, 8_193]) {
			const budget = resolveTokenBudget(window);
			assert.ok(budget.outputTokens > 0, `window ${window} produced no output budget`);
			assert.ok(budget.inputTokens > 0, `window ${window} produced no input budget`);
		}
	});
});
