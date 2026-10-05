import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIN_CLI_REFERENCE_IDS, parseCliReferenceIds } from '../src/cli-reference';

/**
 * The CLI reference page is the supported source of canonical ids on the Go
 * plan, so its parser needs to hold up against the shapes the page actually
 * contains — including the ones that are not model ids.
 */

/** One table row as the page emits it: an id, a name, then a copy control. */
function row(id: string, name: string, blurb: string): string {
	return `<tr><td>${id}</td><td>Copy model id</td><td>${name}</td><td>${blurb}</td></tr>`;
}

const PAGE = [
	'<html><body><table><tbody>',
	'<tr><th>Model ID</th><th></th><th>Name</th><th>Capabilities</th></tr>',
	row('moonshotai/Kimi-K3', 'Kimi K3', 'long-horizon coding with 1M context'),
	row('tencent/hy3-paid', 'Hy3', 'everyday coding'),
	row('inclusionai/ling-3.1-flash:free', 'Ling 3.1 Flash', 'hybrid-reasoning MoE'),
	row('Qwen/Qwen3.8-Omni-Flash', 'Qwen3.8 Omni Flash', 'multimodal'),
	row('stealth/space-bunny-alpha', 'Space Bunny Alpha', 'stealth preview'),
	'</tbody></table>',
	// Prose and code samples that contain slash-shaped tokens which are NOT ids.
	'<p>Point any OpenAI or Anthropic compatible client at https://api.commandcode.ai/provider/v1 Copy and send your first request.</p>',
	'<p>Keys are stored in ~/.commandcode/auth.json. Models arrive on their own.</p>',
	'<p>Use the chat/completions endpoint, or v1/messages for Anthropic wire.</p>',
	'</body></html>',
].join('');

describe('parseCliReferenceIds', () => {
	it('reads the ids the page marks as copyable', () => {
		assert.deepEqual(parseCliReferenceIds(PAGE), [
			'moonshotai/Kimi-K3',
			'tencent/hy3-paid',
			'inclusionai/ling-3.1-flash:free',
			'Qwen/Qwen3.8-Omni-Flash',
			'stealth/space-bunny-alpha',
		]);
	});

	it('keeps vendor casing, which the Generate API requires', () => {
		const ids = parseCliReferenceIds(PAGE);
		// Requests address `moonshotai/Kimi-K3` exactly; lowercasing it 403s.
		assert.ok(ids.includes('moonshotai/Kimi-K3'));
		assert.ok(ids.includes('Qwen/Qwen3.8-Omni-Flash'));
	});

	it('keeps billing qualifiers, which distinguish one model from another', () => {
		const ids = parseCliReferenceIds(PAGE);
		assert.ok(ids.includes('tencent/hy3-paid'), 'the -paid suffix is part of the id');
		assert.ok(ids.includes('inclusionai/ling-3.1-flash:free'), 'the :free tier marker too');
	});

	// The page also contains paths and URLs. Matching on token shape alone would
	// put `chat/completions` and `~/.commandcode/auth.json` into the id index.
	it('ignores prose tokens that are not marked copyable', () => {
		const ids = parseCliReferenceIds(PAGE);
		for (const bogus of ['api.commandcode.ai/provider/v1', 'chat/completions', 'v1/messages']) {
			assert.ok(!ids.includes(bogus), `${bogus} should not be read as a model id`);
		}
	});

	it('ignores JSON config paths', () => {
		assert.ok(!parseCliReferenceIds(PAGE).some((id) => id.endsWith('.json')));
	});

	it('returns nothing for a page with no table', () => {
		assert.deepEqual(parseCliReferenceIds('<html><body>redesigned</body></html>'), []);
		assert.deepEqual(parseCliReferenceIds(''), []);
	});

	it('deduplicates repeated ids', () => {
		const twice = `<p>${row('deepseek/deepseek-v4.1-flash-fast', 'V4.1 Flash', 'fast')}</p>
			<p>${row('deepseek/deepseek-v4.1-flash-fast', 'V4.1 Flash', 'fast')}</p>`;
		assert.deepEqual(parseCliReferenceIds(twice), ['deepseek/deepseek-v4.1-flash-fast']);
	});

	it('reads ids out of script payloads, since the page is server-rendered', () => {
		// The real page's ids live in the rendered body, but a future build could
		// move them into an embedded payload. Stripping scripts must not be the
		// only thing standing between the parser and the data.
		const embedded = `<script>{"models":[{"id":"moonshotai/Kimi-K3"}]}</script>
			<p>${row('zai-org/GLM-5.3', 'GLM-5.3', 'frontier coding')}</p>`;
		assert.deepEqual(parseCliReferenceIds(embedded), ['zai-org/GLM-5.3']);
	});

	it('sets the floor low enough for a legitimately small page', () => {
		// Guards against a floor that would reject the real page after a vendor
		// trims it, which would silently disable the supported id source.
		assert.ok(MIN_CLI_REFERENCE_IDS <= 20, 'floor should tolerate a trimmed page');
		assert.ok(MIN_CLI_REFERENCE_IDS >= 5, 'floor should still reject an empty parse');
	});
});
