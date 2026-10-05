import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatToolCall, ChatUsage } from '../src/types';

/**
 * Reassembly of OpenAI tool-call stream fragments.
 *
 * The shape under test was a real bug: tool names were appended per delta, and
 * the proxy repeats the name on more than one delta, so `get_weather` arrived as
 * `get_weatherget_weather` and Copilot would call a tool that does not exist.
 *
 * The logic is reproduced here rather than imported because it is private to
 * `proxy-client.ts` and that module reaches for the VS Code API. If it is later
 * extracted, this test should import it instead.
 */

interface ToolCallDelta {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

/** Mirror of the accumulator in `proxy-client.ts`. */
function accumulate(deltas: readonly ToolCallDelta[]): ChatToolCall[] {
	const pending = new Map<number, ChatToolCall>();

	for (const fragment of deltas) {
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
		if (fragment.function?.name && !call.function.name) {
			call.function.name = fragment.function.name;
		}
		if (fragment.function?.arguments) {
			call.function.arguments += fragment.function.arguments;
		}
	}

	return [...pending.values()];
}

describe('tool-call stream reassembly', () => {
	it('does not repeat a name the stream sends more than once', () => {
		// This exact sequence was observed from the proxy and produced
		// `get_weatherget_weather` before the fix.
		const calls = accumulate([
			{ index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '' } },
			{ index: 0, function: { name: 'get_weather', arguments: '{"city":' } },
			{ index: 0, function: { name: 'get_weather', arguments: '"Beijing"}' } },
		]);

		assert.equal(calls.length, 1);
		assert.equal(calls[0].function.name, 'get_weather');
		assert.equal(calls[0].function.arguments, '{"city":"Beijing"}');
	});

	it('accumulates argument fragments in order', () => {
		const calls = accumulate([
			{ index: 0, id: 'call_a', function: { name: 'search', arguments: '{"q":' } },
			{ index: 0, function: { arguments: '"vs code",' } },
			{ index: 0, function: { arguments: '"proxy"}' } },
		]);

		assert.equal(calls[0].function.arguments, '{"q":"vs code","proxy"}');
	});

	it('fills a name that the first fragment omitted', () => {
		const calls = accumulate([
			{ index: 0, id: 'call_a', function: { arguments: '{}' } },
			{ index: 0, function: { name: 'list_files', arguments: '' } },
		]);

		assert.equal(calls[0].function.name, 'list_files');
		assert.equal(calls[0].function.arguments, '{}');
	});

	it('keeps parallel tool calls apart by index', () => {
		const calls = accumulate([
			{ index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{"city":' } },
			{ index: 1, id: 'call_b', function: { name: 'get_time', arguments: '{"zone":' } },
			{ index: 0, function: { arguments: '"Beijing"}' } },
			{ index: 1, function: { arguments: '"UTC"}' } },
		]);

		assert.equal(calls.length, 2);
		const byName = new Map(calls.map((c) => [c.function.name, c]));
		assert.equal(byName.get('get_weather')?.function.arguments, '{"city":"Beijing"}');
		assert.equal(byName.get('get_time')?.function.arguments, '{"zone":"UTC"}');
		assert.equal(byName.get('get_weather')?.id, 'call_a');
		assert.equal(byName.get('get_time')?.id, 'call_b');
	});

	it('lets a later id replace a synthesised one', () => {
		const calls = accumulate([
			{ index: 0, function: { name: 'ping', arguments: '' } },
			{ index: 0, id: 'call_real', function: { arguments: '{}' } },
		]);

		assert.equal(calls[0].id, 'call_real');
	});
});

describe('usage mapping', () => {
	it('maps prompt, completion and cache-hit counts', () => {
		const mapped: ChatUsage = {
			prompt_tokens: 100,
			completion_tokens: 20,
			total_tokens: 120,
			prompt_cache_hit_tokens: 8,
		};
		assert.equal(mapped.prompt_tokens + mapped.completion_tokens, 120);
		assert.equal(mapped.prompt_cache_hit_tokens, 8);
	});
});
