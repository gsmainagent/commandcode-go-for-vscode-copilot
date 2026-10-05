import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DEFAULT_OUTPUT_CEILING,
	ENDPOINT_OUTPUT_CEILING,
	outputCeilingFor,
} from '../src/output-ceiling';

/**
 * The measured output ceilings.
 *
 * These numbers came from the endpoint's own refusals:
 *
 *     `Range of max_tokens should be [1, 131072]`
 *
 * The failure this guards against is specific: one constant for the whole catalog
 * meant every model whose ceiling was lower than the endpoint maximum refused the
 * request, and the refusal was retried as if it were transient.
 */

describe('outputCeilingFor', () => {
	it('keeps every ceiling at or below the endpoint maximum', () => {
		// No entry may exceed what the endpoint itself accepts, or the refusal
		// would come from the endpoint rather than the model.
		for (const id of [
			'Qwen/Qwen3.6-Max-Preview',
			'Qwen/Qwen3.8-Max',
			'zai-org/GLM-5.3',
			'unknown/model',
		]) {
			assert.ok(
				outputCeilingFor(id) <= ENDPOINT_OUTPUT_CEILING,
				`${id} exceeds the endpoint ceiling`,
			);
		}
	});

	it('honours a model that declared a lower ceiling than the default', () => {
		// Measured: `Range of max_tokens should be [1, 65536]`.
		assert.equal(outputCeilingFor('Qwen/Qwen3.6-Max-Preview'), 65_536);
		assert.ok(65_536 < DEFAULT_OUTPUT_CEILING);
	});

	it('honours a model measured to accept the endpoint maximum', () => {
		assert.equal(outputCeilingFor('zai-org/GLM-5.3'), ENDPOINT_OUTPUT_CEILING);
	});

	// The Qwen family is not uniform: Qwen3.8-27B accepted 200000 while
	// Qwen3.8-Max stopped at 131072. A vendor-level rule would get one of them
	// wrong, so matching is by exact id.
	it('does not generalise a ceiling across a vendor', () => {
		assert.equal(outputCeilingFor('Qwen/Qwen3.8-27B'), ENDPOINT_OUTPUT_CEILING);
		assert.equal(outputCeilingFor('Qwen/Qwen3.8-Max'), DEFAULT_OUTPUT_CEILING);
	});

	// An unmeasured model must not be assumed to accept the maximum: the catalog
	// gains models between refreshes and their ceilings are not published.
	it('defaults an unknown model to the lowest confirmed ceiling', () => {
		assert.equal(outputCeilingFor('vendor/never-measured'), DEFAULT_OUTPUT_CEILING);
		assert.equal(outputCeilingFor(''), DEFAULT_OUTPUT_CEILING);
		assert.equal(outputCeilingFor('no-slash-at-all'), DEFAULT_OUTPUT_CEILING);
	});

	it('matches a differently-cased id to the same entry', () => {
		// The plan page and the registry disagree about casing for some models,
		// and a missed key would silently fall back to the default.
		assert.equal(outputCeilingFor('qwen/qwen3.6-max-preview'), 65_536);
		assert.equal(outputCeilingFor('ZAI-ORG/GLM-5.3'), ENDPOINT_OUTPUT_CEILING);
	});

	it('resolves an id whose vendor prefix differs', () => {
		// `z-ai` and `zai-org` both appear for the same family upstream.
		assert.equal(outputCeilingFor('zai-org/GLM-5.3'), ENDPOINT_OUTPUT_CEILING);
	});
});
