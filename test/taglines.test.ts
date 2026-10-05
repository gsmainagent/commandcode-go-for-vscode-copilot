import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MODELS } from '../src/models';

/**
 * The picker taglines.
 *
 * The curated registry stores an i18n key rather than text, because `i18n.ts`
 * imports the VS Code API and so cannot be imported by the unit tests. The
 * consequence is that a wrong key fails silently: the display layer drops the
 * tagline rather than showing a raw `model.detail.…` string. These tests read
 * `i18n.ts` as source to catch that, which is the only place both sides are
 * visible at once.
 */

// The suite compiles into `.test-build/test/`, so the repository root is two
// levels up rather than one.
const REPO_ROOT = join(__dirname, '..', '..');
const I18N_SOURCE = readFileSync(join(REPO_ROOT, 'src', 'i18n.ts'), 'utf8');

/** Every key declared in either dictionary, with the language it was found in. */
function declaredKeys(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const match of I18N_SOURCE.matchAll(/'([a-zA-Z0-9._-]+)':/g)) {
		const key = match[1];
		if (!key.startsWith('model.detail.')) {
			continue;
		}
		// A key appears once per dictionary; count occurrences to tell which.
		const occurrences = [...I18N_SOURCE.matchAll(new RegExp(`'${key}':`, 'g'))].length;
		const langs = found.get(key) ?? [];
		langs.push(occurrences >= 2 ? 'en+zh' : 'one-dictionary-only');
		found.set(key, langs);
	}
	return found;
}

describe('registry taglines', () => {
	it('stores an i18n key rather than literal text', () => {
		const literals = MODELS.filter((m) => m.detail && !m.detailKey);
		assert.deepEqual(
			literals.map((m) => `${m.id}: ${m.detail}`),
			[],
			'registry entries must carry detailKey, not a hardcoded tagline',
		);
	});

	it('keys every entry that has a tagline', () => {
		const keyed = MODELS.filter((m) => m.detailKey);
		assert.ok(keyed.length > 0, 'no registry entry carries a tagline key');
		for (const model of keyed) {
			assert.match(
				model.detailKey!,
				/^model\.detail\.[a-z0-9]+(-[a-z0-9]+)*$/,
				`${model.id} has a malformed key: ${model.detailKey}`,
			);
		}
	});

	it('derives each key from its own model id', () => {
		// A copy-pasted key would show one model's tagline under another.
		for (const model of MODELS.filter((m) => m.detailKey)) {
			const tail = model.id.slice(model.id.lastIndexOf('/') + 1).toLowerCase();
			const expected = tail.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
			assert.ok(
				model.detailKey!.endsWith(expected),
				`${model.id} has key ${model.detailKey}, expected it to end with "${expected}"`,
			);
		}
	});

	it('declares every key in both dictionaries', () => {
		const declared = declaredKeys();
		const orphans = [];
		for (const model of MODELS.filter((m) => m.detailKey)) {
			const langs = declared.get(model.detailKey!);
			if (!langs) {
				orphans.push(`${model.detailKey} (${model.id}): not declared in i18n.ts`);
			} else if (langs.some((l) => l !== 'en+zh')) {
				orphans.push(`${model.detailKey} (${model.id}): declared in only one dictionary`);
			}
		}
		assert.deepEqual(orphans, [], 'a tagline key would silently render nothing');
	});

	it('has no key in i18n.ts that the registry does not reference', () => {
		const referenced = new Set(MODELS.map((m) => m.detailKey).filter(Boolean));
		const stale = [...declaredKeys().keys()].filter((k) => !referenced.has(k));
		assert.deepEqual(stale, [], 'i18n.ts declares taglines no model uses');
	});

	it('keeps one tagline per model', () => {
		const keys = MODELS.map((m) => m.detailKey).filter(Boolean);
		assert.equal(new Set(keys).size, keys.length, 'two models share a tagline key');
	});
});
