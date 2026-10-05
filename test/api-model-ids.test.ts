import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { fetchApiModelIds } from '../src/api-model-ids';

/**
 * The id source must work without a key.
 *
 * `GET /provider/v1/models` answers 200 with usable ids when called
 * unauthenticated (measured 2026-10-05: 85 ids, HTTP 200, no credentials). An
 * earlier version returned early when `apiKey` was undefined, which threw away
 * the last remaining id source.
 *
 * The consequence was not graceful degradation. A plan row whose id cannot be
 * resolved keeps its bare slug, and a bare slug is refused upstream as
 * `Model/provider not recognized: anthropic:<slug>` — so all 53 models failed
 * identically, with the error naming the model rather than the missing
 * credential. Renaming the extension changed its id, which reset VS Code's
 * SecretStorage, so a missing key was the normal case rather than an edge one.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

interface StubCall {
	url: string;
	headers: Record<string, string>;
}

/** Record requests and answer with a catalog of `count` ids. */
function stubFetch(count: number, status = 200): StubCall[] {
	const calls: StubCall[] = [];
	globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
		const headers = (init?.headers ?? {}) as Record<string, string>;
		calls.push({ url: String(input), headers });
		if (status !== 200) {
			return new Response('nope', { status });
		}
		return new Response(
			JSON.stringify({
				object: 'list',
				data: Array.from({ length: count }, (_, i) => ({
					id: `vendor/model-${i + 1}`,
					object: 'model',
				})),
			}),
			{ status: 200 },
		);
	}) as typeof fetch;
	return calls;
}

describe('fetchApiModelIds', () => {
	it('returns ids when no key is configured', async () => {
		// The guard this test exists for.
		stubFetch(85);
		const ids = await fetchApiModelIds({
			baseUrl: 'https://example.test/provider/v1',
			apiKey: undefined,
		});
		assert.equal(ids.length, 85, 'a missing key must not discard the last id source');
		assert.equal(ids[0], 'vendor/model-1');
	});

	it('omits the Authorization header when there is no key', async () => {
		// An empty bearer can be read as a malformed credential rather than none.
		const calls = stubFetch(3);
		await fetchApiModelIds({ baseUrl: 'https://example.test/provider/v1', apiKey: undefined });
		const headers = calls[0].headers;
		const hasAuth =
			'Authorization' in headers ||
			Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
		assert.equal(hasAuth, false, 'no key means no Authorization header, not an empty one');
	});

	it('still sends the key when one is configured', async () => {
		// It can only widen the answer, so there is no reason to drop it.
		const calls = stubFetch(3);
		await fetchApiModelIds({ baseUrl: 'https://example.test/provider/v1', apiKey: 'secret' });
		assert.equal(calls[0].headers['Authorization'], 'Bearer secret');
	});

	it('keeps sending the client headers either way', async () => {
		// These identify the caller, independently of authentication.
		const calls = stubFetch(1);
		await fetchApiModelIds({ baseUrl: 'https://example.test/provider/v1', apiKey: undefined });
		assert.equal(calls[0].headers['x-cli-environment'], 'production');
		assert.ok(calls[0].headers['x-command-code-version']);
	});

	it('returns nothing on a non-200, so the caller falls back', async () => {
		// This source is unsupported on Go and last in the chain; a 403 here is
		// normal, not an error worth surfacing.
		stubFetch(0, 403);
		const ids = await fetchApiModelIds({
			baseUrl: 'https://example.test/provider/v1',
			apiKey: 'k',
		});
		assert.deepEqual(ids, []);
	});

	it('returns nothing when the network throws', async () => {
		globalThis.fetch = (async () => {
			throw new Error('offline');
		}) as typeof fetch;
		const ids = await fetchApiModelIds({
			baseUrl: 'https://example.test/provider/v1',
			apiKey: 'k',
		});
		assert.deepEqual(ids, []);
	});

	it('tolerates a body without a data array', async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ object: 'list' }), { status: 200 })) as typeof fetch;
		const ids = await fetchApiModelIds({
			baseUrl: 'https://example.test/provider/v1',
			apiKey: 'k',
		});
		assert.deepEqual(ids, []);
	});

	it('drops entries whose id is not a non-empty string', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					data: [{ id: 'good/one' }, { id: '' }, { id: 42 }, { nope: true }, null],
				}),
				{ status: 200 },
			)) as typeof fetch;
		const ids = await fetchApiModelIds({
			baseUrl: 'https://example.test/provider/v1',
			apiKey: 'k',
		});
		assert.deepEqual(ids, ['good/one']);
	});

	it('requests the models path of the configured base', async () => {
		const calls = stubFetch(1);
		await fetchApiModelIds({ baseUrl: 'https://example.test/provider/v1', apiKey: 'k' });
		assert.equal(calls[0].url, 'https://example.test/provider/v1/models');
	});
});
