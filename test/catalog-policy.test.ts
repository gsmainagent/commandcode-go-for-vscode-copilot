import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_REFRESH_MINUTES, shouldRefresh, snapshotAge } from '../src/catalog-policy';

const MINUTE = 60_000;
const NOW = 1_700_000_000_000;

describe('shouldRefresh', () => {
	it('refreshes when nothing is cached', () => {
		assert.equal(
			shouldRefresh({ checkedAt: undefined, refreshMinutes: 30, forceRefresh: false, now: NOW }),
			true,
		);
	});

	it('refreshes when the user asks for it', () => {
		assert.equal(
			shouldRefresh({ checkedAt: NOW, refreshMinutes: 30, forceRefresh: true, now: NOW }),
			true,
		);
	});

	// The gap that made the README wrong: the list never refetched on its own, so
	// a newly published model stayed invisible until a manual refresh.
	it('refreshes once the snapshot ages out', () => {
		assert.equal(
			shouldRefresh({
				checkedAt: NOW - 31 * MINUTE,
				refreshMinutes: 30,
				forceRefresh: false,
				now: NOW,
			}),
			true,
		);
	});

	it('serves a fresh snapshot without touching the network', () => {
		assert.equal(
			shouldRefresh({
				checkedAt: NOW - 29 * MINUTE,
				refreshMinutes: 30,
				forceRefresh: false,
				now: NOW,
			}),
			false,
		);
	});

	it('clamps a zero or negative interval to one minute instead of spinning', () => {
		// Refetching on every query would hammer the docs page. Clamping to a
		// minute bounds the staleness instead. In practice config.ts normalizes
		// these values to the default before they arrive.
		for (const refreshMinutes of [0, -5]) {
			assert.equal(
				shouldRefresh({ checkedAt: NOW, refreshMinutes, forceRefresh: false, now: NOW }),
				false,
				'a snapshot taken just now is fresh even on a zero interval',
			);
			assert.equal(
				shouldRefresh({
					checkedAt: NOW - 2 * MINUTE,
					refreshMinutes,
					forceRefresh: false,
					now: NOW,
				}),
				true,
				'once past a minute the list refetches',
			);
		}
	});

	it('respects a custom interval', () => {
		const checkedAt = NOW - 45 * MINUTE;
		assert.equal(
			shouldRefresh({ checkedAt, refreshMinutes: 60, forceRefresh: false, now: NOW }),
			false,
			'45 min old is still fresh on a 60 min interval',
		);
		assert.equal(
			shouldRefresh({ checkedAt, refreshMinutes: 10, forceRefresh: false, now: NOW }),
			true,
		);
	});

	it('treats a corrupted timestamp as stale so the cache heals itself', () => {
		// A stored `checkedAt` of 0 survives round-tripping through JSON but means
		// "never refreshed"; it must not pin the picker to ancient data.
		assert.equal(
			shouldRefresh({ checkedAt: 0, refreshMinutes: 30, forceRefresh: false, now: NOW }),
			true,
		);
	});
});

describe('snapshotAge', () => {
	it('labels a snapshot for the logs', () => {
		assert.equal(snapshotAge(undefined, NOW), 'missing');
		assert.equal(snapshotAge(NOW, NOW), 'fresh');
		assert.equal(snapshotAge(NOW - (DEFAULT_REFRESH_MINUTES + 1) * MINUTE, NOW), 'expired');
	});
});
