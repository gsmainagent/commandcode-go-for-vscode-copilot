import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeUpstreamProxy } from '../src/endpoint';

/**
 * The upstream proxy value is validated rather than passed through.
 *
 * `proxy.mjs` refuses to boot when `upstreamProxy` is not an `http://` URL, and
 * it does that check at startup specifically so a typo cannot turn into one
 * opaque 502 per request. The consequence for this extension is the reason the
 * validation lives here instead of at the call site: a value that stops the
 * proxy from starting takes down *every* model in the picker, not just the one
 * the user was trying to fix.
 *
 * So an unusable value is dropped, the request goes direct, and the extension
 * keeps working in the state it already worked in.
 */
describe('normalizeUpstreamProxy', () => {
	it('keeps a well-formed http URL', () => {
		assert.equal(normalizeUpstreamProxy('http://127.0.0.1:7897'), 'http://127.0.0.1:7897');
	});

	it('treats an empty value as unset', () => {
		// The default, and what a user gets after clearing the setting.
		assert.equal(normalizeUpstreamProxy(''), undefined);
		assert.equal(normalizeUpstreamProxy('   '), undefined);
		assert.equal(normalizeUpstreamProxy(undefined), undefined);
	});

	// The case that motivated the setting: Clash's mixed port serves SOCKS5 and
	// HTTP CONNECT on one port, and the proxy only speaks CONNECT.
	it('rejects socks5, which the proxy cannot use', () => {
		assert.equal(normalizeUpstreamProxy('socks5://127.0.0.1:7897'), undefined);
		assert.equal(normalizeUpstreamProxy('socks5h://127.0.0.1:7897'), undefined);
	});

	it('rejects every other scheme', () => {
		// Notably https:// — an easy mistake, since the target itself is https.
		// Passing it through would stop the proxy from starting.
		assert.equal(normalizeUpstreamProxy('https://127.0.0.1:7897'), undefined);
		assert.equal(normalizeUpstreamProxy('ftp://127.0.0.1:7897'), undefined);
	});

	it('rejects a value that is not a URL', () => {
		assert.equal(normalizeUpstreamProxy('127.0.0.1:7897'), undefined);
		assert.equal(normalizeUpstreamProxy('localhost'), undefined);
		assert.equal(normalizeUpstreamProxy('not a url at all'), undefined);
	});

	it('trims surrounding whitespace', () => {
		assert.equal(normalizeUpstreamProxy('  http://127.0.0.1:7897  '), 'http://127.0.0.1:7897');
	});

	it('keeps credentials in the URL for the proxy to use', () => {
		// proxy.mjs handles user:pass itself, and only redacts it from logs, so
		// stripping the credentials here would break authenticated proxies.
		assert.equal(
			normalizeUpstreamProxy('http://user:secret@proxy.internal:3128'),
			'http://user:secret@proxy.internal:3128',
		);
	});

	it('states port 80 when the URL omits it', () => {
		// A local proxy is never listening on 80, so naming the port explicitly
		// is clearer than letting the scheme's default travel downstream. It also
		// keeps the stored value identical to what the user typed, which
		// `URL.toString()` does not: it both adds a trailing slash and drops `:80`.
		assert.equal(normalizeUpstreamProxy('http://127.0.0.1'), 'http://127.0.0.1:80');
	});

	it('does not append a trailing slash to a bare authority', () => {
		assert.equal(normalizeUpstreamProxy('http://127.0.0.1:7897'), 'http://127.0.0.1:7897');
	});

	it('accepts a hostname proxy, not just an IP', () => {
		assert.equal(
			normalizeUpstreamProxy('http://proxy.internal:3128'),
			'http://proxy.internal:3128',
		);
	});

	it('never returns a value the proxy would refuse to start with', () => {
		// The invariant, checked against the cases that matter. proxy.mjs exits
		// with code 1 on anything that is not http://, and a dead proxy fails
		// all 53 models at once.
		const candidates = [
			'http://127.0.0.1:7897',
			'https://127.0.0.1:7897',
			'socks5://127.0.0.1:7897',
			'socks5h://127.0.0.1:7897',
			'127.0.0.1:7897',
			'http://',
			'',
			'   ',
			'ftp://x:21',
		];
		for (const raw of candidates) {
			const result = normalizeUpstreamProxy(raw);
			if (result !== undefined) {
				assert.equal(
					new URL(result).protocol,
					'http:',
					`"${raw}" must never be passed on as a non-http URL`,
				);
			}
		}
	});
});
