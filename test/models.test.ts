import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CONSERVATIVE_CAPABILITIES, measuredCapabilities } from '../src/capabilities';
import { toModelDefinition } from '../src/models';
import { ENDPOINT_OUTPUT_CEILING } from '../src/output-ceiling';

/**
 * These cover the two decisions that most affect what Copilot actually sends:
 * whether a model is treated as vision-capable, and how its token window is
 * reported.
 *
 * The vision flags matter because Copilot Chat sends image parts whenever
 * `imageInput` is true. Getting that wrong on a text-only model hands it image
 * bytes it cannot read.
 */

const kimi: Parameters<typeof toModelDefinition>[1] = {
	id: 'moonshotai/Kimi-K3',
	name: 'Kimi K3',
	contextLength: 1_000_000,
	vision: true,
	reasoning: true,
};

describe('toModelDefinition: capabilities', () => {
	it('trusts a vendor declaration of vision support', () => {
		// Regression: an earlier build inferred this by probing through a proxy
		// that dropped image parts, so every Kimi was marked text-only.
		const def = toModelDefinition(kimi.id, kimi);
		assert.equal(def.capabilities.imageInput, true);
		assert.notEqual(def.capabilities.thinking, false);
	});

	it('honours a vendor declaration of no vision support', () => {
		const def = toModelDefinition('deepseek/deepseek-v4-pro', {
			id: 'deepseek/deepseek-v4-pro',
			name: 'DeepSeek V4 Pro',
			contextLength: 1_000_000,
			vision: false,
			reasoning: true,
		});
		assert.equal(def.capabilities.imageInput, false);
	});

	// A vendor `false` is a statement; the compiled table must not override it.
	it('does not let the compiled table override a vendor false', () => {
		const compiled = measuredCapabilities('deepseek/deepseek-v4-pro');
		assert.equal(compiled?.vision, false, 'table agrees for this model');

		const def = toModelDefinition('deepseek/deepseek-v4-pro', {
			id: 'deepseek/deepseek-v4-pro',
			name: 'DeepSeek V4 Pro',
			contextLength: 1_000_000,
			vision: false,
			reasoning: true,
		});
		assert.equal(def.capabilities.imageInput, false);
	});

	it('falls back to the compiled table when the plan row said nothing', () => {
		// No `vision` field at all: "nobody said", so consult the generated table.
		const def = toModelDefinition('moonshotai/Kimi-K3', {
			id: 'moonshotai/Kimi-K3',
			name: 'Kimi K3',
			contextLength: 1_000_000,
		});
		assert.equal(def.capabilities.imageInput, measuredCapabilities('moonshotai/Kimi-K3')?.vision);
	});

	it('falls back to conservative defaults for an unknown model', () => {
		const def = toModelDefinition('vendor/never-heard-of-it', {
			id: 'vendor/never-heard-of-it',
			name: 'Mystery',
			contextLength: 128_000,
		});
		assert.equal(def.capabilities.imageInput, CONSERVATIVE_CAPABILITIES.vision);
		assert.equal(def.capabilities.imageInput, false, 'unknown means no images, not optimistic');
	});
});

describe('toModelDefinition: token windows', () => {
	// Probing `/alpha/generate` put the hard limit at exactly 200000: 200000 is
	// accepted, 200001 is refused with `400 BAD_REQUEST — Too big`. A model's
	// 1M window is not a usable output budget, so the window is split and the
	// endpoint ceiling decides the output share.
	it('caps output at the probed endpoint ceiling', () => {
		const def = toModelDefinition(kimi.id, kimi);
		assert.equal(def.maxOutputTokens, ENDPOINT_OUTPUT_CEILING);
		assert.equal(def.maxInputTokens, 1_000_000 - ENDPOINT_OUTPUT_CEILING);
	});

	it('splits the window instead of double-counting it', () => {
		const def = toModelDefinition('gpt-6-luna', {
			id: 'gpt-6-luna',
			name: 'GPT-6 Luna',
			contextLength: 1_100_000,
			vision: true,
			reasoning: true,
		});
		assert.equal(def.maxInputTokens + def.maxOutputTokens, 1_100_000);
	});

	it('keeps input usable when the window is smaller than the ceiling', () => {
		// A 175K model would otherwise reserve its whole window for output and
		// report maxInputTokens: 1.
		const def = toModelDefinition('zai-org/GLM-5.3', {
			id: 'zai-org/GLM-5.3',
			name: 'GLM-5.3',
			contextLength: 175_000,
			reasoning: true,
		});
		assert.ok(def.maxInputTokens >= def.maxOutputTokens);
		assert.equal(def.maxInputTokens + def.maxOutputTokens, 175_000);
	});

	it('never reports a zero or negative window', () => {
		const def = toModelDefinition('vendor/no-window-stated', {
			id: 'vendor/no-window-stated',
			name: 'Mystery',
			contextLength: 0,
		});
		assert.ok(def.maxInputTokens > 0);
		assert.ok(def.maxOutputTokens > 0);
	});

	it('passes the user setting through to the shared budget', () => {
		const def = toModelDefinition(kimi.id, kimi, 50_000);
		assert.equal(def.maxOutputTokens, 50_000);
		assert.equal(def.maxInputTokens, 950_000);
	});
});

describe('toModelDefinition: identity', () => {
	it('prefers the plan page display name for registry-known ids', () => {
		const def = toModelDefinition(kimi.id, kimi);
		assert.equal(def.id, 'moonshotai/Kimi-K3');
		assert.equal(def.name, 'Kimi K3');
	});

	it('marks models with no registry entry as fetched', () => {
		const def = toModelDefinition('vendor/newcomer', {
			id: 'vendor/newcomer',
			name: 'Newcomer',
			contextLength: 256_000,
		});
		assert.equal(def.fetched, true);
		assert.equal(def.name, 'Newcomer');
	});
});
