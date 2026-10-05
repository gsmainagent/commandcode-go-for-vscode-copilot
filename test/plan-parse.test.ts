import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	MIN_PLAN_MODELS,
	buildModelIdIndex,
	matchPlanRows,
	parseContextTokens,
	parsePlanTable,
	slugifyModelKey,
} from '../src/plan-parse';

/**
 * Stand-in for the real plan table.
 *
 * Shaped like the markup the docs site emits: a `<thead>` naming each column,
 * a model cell holding a link plus the off-peak/peak summary, an `Intelligence`
 * score, four price cells whose `aria-label` names the column, and a `Caps`
 * button. Only 15 of 53 real rows label their price column at all — the rest
 * say `N context price bands` and are identifiable solely from the header.
 */
function cell(inner: string, _aria?: string, cls = 'p-2 whitespace-nowrap'): string {
	return `<td data-slot="table-cell" class="${cls}">${inner}</td>`;
}

function row(opts: {
	slug: string;
	name: string;
	context?: string;
	intelligence?: string;
	caps?: string;
	pricing?: { input?: string; output?: string; cacheRead?: string; peakInput?: string };
}): string {
	const modelCell = cell(
		`<span><a href="/models/${opts.slug}"><span class="truncate">${opts.name}</span></a></span>` +
			`<button type="button" class="hidden" aria-label="${
				opts.pricing?.peakInput ? `Off-peak shown (17h/day) · peak $${opts.pricing.peakInput}` : ''
			}"></button>`,
		undefined,
		'p-2 pl-3',
	);
	const contextCell = cell(opts.context ?? '—', undefined, 'p-2 text-right font-mono');
	const intelCell = cell(opts.intelligence ?? 'not yet scored');
	const inputCell = cell(
		`$${opts.pricing?.input ?? '0.10'}`,
		`${opts.name} input${opts.pricing?.peakInput ? `: $${opts.pricing.peakInput} during peak hours, 01–04 & 06–10 UTC, Mon–Fri` : ''}`,
	);
	const outputCell = cell(`$${opts.pricing?.output ?? '0.50'}`, `${opts.name} output`);
	const cacheReadCell = cell(`$${opts.pricing?.cacheRead ?? '0.01'}`, `${opts.name} cache read`);
	const cacheWriteCell = cell('—', undefined);
	const capsCell = cell(
		opts.caps
			? `<button type="button" aria-label="Capabilities: ${opts.caps}"><svg viewBox="0 0 24 24"></svg></button>`
			: '—',
	);
	return `<tr data-slot="table-row">${modelCell}${contextCell}${intelCell}${inputCell}${outputCell}${cacheReadCell}${cacheWriteCell}${capsCell}</tr>`;
}

/** The real header order. Without it, context and intelligence cannot be read. */
const THEAD =
	'<thead><tr>' +
	['Model', 'Context', 'Intelligence', 'Input', 'Output', 'Cache read', 'Cache write', 'Caps']
		.map((label) => `<th class="p-2"><span>${label} ↕</span></th>`)
		.join('') +
	'</tr></thead>';

const TABLE = [
	'<table><tbody>',
	THEAD,
	row({
		slug: 'kimi-k3',
		name: 'Kimi K3',
		context: '1M',
		intelligence: '43.6',
		caps: 'Text input, Vision, Reasoning',
		pricing: { input: '3', output: '15', cacheRead: '0.3' },
	}),
	row({
		slug: 'deepseek-v4-1-flash-fast',
		name: 'DeepSeek V4.1 Flash Fast',
		context: '1M',
		// Caps omits Vision on purpose: the assertion below needs a label that
		// states a capability negatively rather than staying silent.
		caps: 'Text input, Reasoning',
		pricing: { input: '0.16', output: '0.58', cacheRead: '0.016', peakInput: '0.32' },
	}),
	row({ slug: 'tencent-hy3', name: 'Tencent Hy3', context: '262K', caps: 'Text input, Reasoning' }),
	row({
		slug: 'ling-3-1-flash-free',
		name: 'Ling 3.1 Flash Free',
		context: '262K',
		caps: 'Text input, Reasoning',
	}),
	row({
		slug: 'glm-5-3-flash',
		name: 'GLM-5.3 Flash',
		context: '1M',
		intelligence: '41.8',
		caps: 'Text input, Vision, Reasoning',
	}),
	// A row whose Caps cell lost its label: "nobody said", not "no vision".
	row({ slug: 'mystery-model', name: 'Mystery', context: '128K' }),
	'</tbody></table>',
].join('');

describe('parsePlanTable', () => {
	it('extracts one row per model link', () => {
		const rows = parsePlanTable(TABLE);
		assert.equal(rows.length, 6, 'five models plus the header row');
		assert.deepEqual(
			rows.map((r) => r.slug),
			[
				'kimi-k3',
				'deepseek-v4-1-flash-fast',
				'tencent-hy3',
				'ling-3-1-flash-free',
				'glm-5-3-flash',
				'mystery-model',
			],
		);
	});

	it('reads vendor capabilities from the Caps aria-label', () => {
		const rows = parsePlanTable(TABLE);
		const kimi = rows.find((r) => r.slug === 'kimi-k3');
		assert.deepEqual(kimi?.caps, { vision: true, reasoning: true });

		const deepseek = rows.find((r) => r.slug === 'deepseek-v4-1-flash-fast');
		assert.deepEqual(
			deepseek?.caps,
			{ vision: false, reasoning: true },
			'a label that omits Vision is authoritative false, not unknown',
		);
	});

	it('distinguishes a missing Caps label from a negative declaration', () => {
		const rows = parsePlanTable(TABLE);
		const mystery = rows.find((r) => r.slug === 'mystery-model');
		assert.equal(
			mystery?.caps,
			undefined,
			'no aria-label must stay undefined so callers fall through to the compiled table',
		);
	});

	it('reads display names and context windows', () => {
		const rows = parsePlanTable(TABLE);
		const kimi = rows.find((r) => r.slug === 'kimi-k3');
		assert.equal(kimi?.name, 'Kimi K3');
		assert.equal(kimi?.contextLength, 1_000_000);

		const hy3 = rows.find((r) => r.slug === 'tencent-hy3');
		assert.equal(hy3?.contextLength, 262_000);
	});

	it('returns nothing when the table is gone, so the caller can fall back', () => {
		assert.deepEqual(parsePlanTable('<html><body>redesigned</body></html>'), []);
		assert.deepEqual(parsePlanTable(''), []);
	});
});

describe('parseContextTokens', () => {
	it('parses the units the plan page uses', () => {
		assert.equal(parseContextTokens('1M'), 1_000_000);
		assert.equal(parseContextTokens('262K'), 262_000);
		assert.equal(parseContextTokens('1.1M'), 1_100_000);
		assert.equal(parseContextTokens('200K'), 200_000);
	});

	it('rejects anything that is not a bare size', () => {
		assert.equal(parseContextTokens('Free'), undefined);
		assert.equal(parseContextTokens('$0.16 +1'), undefined);
		assert.equal(parseContextTokens(''), undefined);
	});
});

describe('slugifyModelKey', () => {
	it('folds the punctuation that differs between the two sources', () => {
		// catalog `deepseek-v4.1-flash-fast` vs docs `deepseek-v4-1-flash-fast`
		assert.equal(
			slugifyModelKey('deepseek-v4.1-flash-fast'),
			slugifyModelKey('deepseek-v4-1-flash-fast'),
		);
		// catalog `ling-3.1-flash:free` vs docs `ling-3-1-flash-free`
		assert.equal(slugifyModelKey('ling-3.1-flash:free'), slugifyModelKey('ling-3-1-flash-free'));
	});
});

describe('buildModelIdIndex', () => {
	const known = [
		'moonshotai/Kimi-K3',
		'deepseek/deepseek-v4.1-flash-fast',
		'tencent/hy3-paid',
		'inclusionai/ling-3.1-flash:free',
		'z-ai/glm-5.3-flash',
	];

	it('maps a bare docs slug onto the canonical API id', () => {
		const index = buildModelIdIndex(known);
		assert.equal(index.get('kimi-k3'), 'moonshotai/Kimi-K3');
	});

	it('absorbs the dot/hyphen difference between catalog and docs', () => {
		const index = buildModelIdIndex(known);
		assert.equal(index.get('deepseek-v4-1-flash-fast'), 'deepseek/deepseek-v4.1-flash-fast');
	});

	// Regression: the docs link `tencent-hy3` while the catalog serves
	// `tencent/hy3-paid`, so without the billing-suffix aliases the model silently
	// vanished from the picker even though the plan includes it.
	it('tolerates billing qualifiers the docs drop', () => {
		const index = buildModelIdIndex(known);
		assert.equal(index.get('tencent-hy3'), 'tencent/hy3-paid');
		assert.equal(index.get('hy3'), 'tencent/hy3-paid');
		assert.equal(index.get('ling-3-1-flash-free'), 'inclusionai/ling-3.1-flash:free');
	});

	it('indexes the vendor-qualified form too', () => {
		const index = buildModelIdIndex(known);
		assert.equal(
			index.get('zai-glm-5-3-flash'),
			undefined,
			'not a real id; guards against over-matching',
		);
		assert.equal(index.get('glm-5-3-flash'), 'z-ai/glm-5.3-flash');
	});
});

describe('matchPlanRows', () => {
	const known = ['moonshotai/Kimi-K3', 'tencent/hy3-paid'];

	it('rewrites every row to the id requests must use', () => {
		const rows = parsePlanTable(TABLE);
		const matched = matchPlanRows(rows, known);
		const byId = new Map(matched.map((m) => [m.slug, m.id]));

		assert.equal(byId.get('kimi-k3'), 'moonshotai/Kimi-K3');
		assert.equal(byId.get('tencent-hy3'), 'tencent/hy3-paid');
	});

	// Owner decision: extra entries are fine, missing ones are not. A model the
	// page lists before the API catalog knows it keeps its slug, so it appears
	// now and starts working once the catalog catches up.
	it('keeps an unmapped row under its slug rather than dropping it', () => {
		const rows = parsePlanTable(TABLE);
		const matched = matchPlanRows(rows, known);
		const unmapped = matched.filter((m) => m.id === m.slug);

		assert.ok(unmapped.length > 0, 'rows outside the catalog survive');
		assert.ok(
			unmapped.some((m) => m.slug === 'kimi-k3' || m.slug === 'deepseek-v4-1-flash-fast'),
			'every unresolvable slug is present',
		);
		assert.equal(matched.length, rows.length, 'no row is ever dropped');
	});
});

describe('MIN_PLAN_MODELS tripwire', () => {
	it('rejects a truncated parse', () => {
		// A layout change that yields only the two rows in this small table must
		// read as a failure, not as a shrunken plan.
		const small = `<table><tbody>${row({ slug: 'a', name: 'A', context: '1M', caps: 'Text input' })}${row({ slug: 'b', name: 'B', context: '1M', caps: 'Text input' })}</tbody></table>`;
		const rows = parsePlanTable(small);
		assert.ok(rows.length < MIN_PLAN_MODELS);
	});
});
