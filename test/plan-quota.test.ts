import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	MIN_PLAN_MODELS,
	parsePlanTable,
	parseQuotaTable,
	slugifyModelKey,
} from '../src/plan-parse';

/**
 * The plan page's request-allowance table.
 *
 * It is a second table on the page, so it is located by its own header rather
 * than by position. The two tables share only the display name, which is what
 * makes the join the fragile part — and what made an earlier version of this
 * attach only 13 of the 41 available allowances.
 *
 * The fixture copies the awkward cases verbatim: thousands separators, three
 * fractional counts, and rows the table simply does not list.
 */

const td = (text: string): string => `<td class="p-2">${text}</td>`;

function quotaRow(name: string, perFiveHours: string, perWeek: string, perMonth: string): string {
	return `<tr data-slot="table-row">${td(name)}${td(perFiveHours)}${td(perWeek)}${td(perMonth)}</tr>`;
}

const QUOTA_TABLE = [
	'<table><tbody>',
	'<thead><tr>' +
		['Model', 'Requests / 5 hours', 'Requests / week', 'Requests / month']
			.map((label) => `<th class="p-2"><span>${label}</span></th>`)
			.join('') +
		'</tr></thead>',
	// Whole numbers with thousands separators.
	quotaRow('DeepSeek V4 Flash (latest)', '4,620', '9,230', '15,400'),
	quotaRow('DeepSeek V4.1 Flash', '7,690', '15,400', '25,600'),
	// Fractional counts, which the page really prints.
	quotaRow('Grok 4.5', '64.7', '129', '216'),
	quotaRow('GLM-5.2 Fast', '93.3', '187', '311'),
	quotaRow('Kimi K2.7 Code HighSpeed', '81.4', '163', '271'),
	// Small counts, to catch a parser that assumes four digits.
	quotaRow('GLM-5.2', '203', '406', '677'),
	'</tbody></table>',
].join('');

/** The model list, which carries no allowance of its own. */
function modelRow(slug: string, name: string): string {
	return (
		'<tr data-slot="table-row">' +
		`<td class="p-2 pl-3"><span><a href="/models/${slug}"><span class="truncate">${name}</span></a></span></td>` +
		'<td class="p-2 text-right font-mono">1M</td>' +
		'<td class="p-2">not yet scored</td>' +
		'<td class="p-2">$0.30</td>' +
		'<td class="p-2">$1.20</td>' +
		'<td class="p-2">$0.006</td>' +
		'<td class="p-2">—</td>' +
		'<td class="p-2"><button type="button" aria-label="Capabilities: Text input, Reasoning"><svg viewBox="0 0 24 24"></svg></button></td>' +
		'</tr>'
	);
}

const PLAN_TABLE = [
	'<table><tbody>',
	'<thead><tr>' +
		['Model', 'Context', 'Intelligence', 'Input', 'Output', 'Cache read', 'Cache write', 'Caps']
			.map((label) => `<th class="p-2"><span>${label} ↕</span></th>`)
			.join('') +
		'</tr></thead>',
	modelRow('deepseek-v4-flash', 'DeepSeek V4 Flash (latest)'),
	modelRow('deepseek-v4-1-flash', 'DeepSeek V4.1 Flash'),
	modelRow('grok-4-5', 'Grok 4.5'),
	modelRow('glm-5-2-fast', 'GLM-5.2 Fast'),
	modelRow('glm-5-2', 'GLM-5.2'),
	// Present in the model list, absent from the allowance table.
	modelRow('kimi-k3', 'Kimi K3'),
	'</tbody></table>',
].join('');

const PAGE = PLAN_TABLE + QUOTA_TABLE;

describe('parseQuotaTable', () => {
	it('reads every allowance the page states', () => {
		const quotas = parseQuotaTable(PAGE);
		assert.equal(quotas.size, 6);
	});

	it('strips thousands separators', () => {
		const quotas = parseQuotaTable(PAGE);
		const deepseek = quotas.get(slugifyModelKey('DeepSeek V4 Flash (latest)'));
		assert.deepEqual(deepseek, { perFiveHours: 4620, perWeek: 9230, perMonth: 15400 });
	});

	it('keeps fractional counts instead of rounding them', () => {
		// The page prints 64.7 and 93.3 where every other row is whole. Rounding
		// would misstate a per-window allowance, and reading them as thousands
		// would overstate it by three orders of magnitude.
		const quotas = parseQuotaTable(PAGE);
		const grok = quotas.get(slugifyModelKey('Grok 4.5'));
		assert.deepEqual(grok, { perFiveHours: 64.7, perWeek: 129, perMonth: 216 });
		const glm = quotas.get(slugifyModelKey('GLM-5.2 Fast'));
		assert.equal(glm?.perFiveHours, 93.3);
	});

	it('handles small counts', () => {
		const quotas = parseQuotaTable(PAGE);
		assert.equal(quotas.get(slugifyModelKey('GLM-5.2'))?.perFiveHours, 203);
	});

	it('drops a row rather than recording it partially', () => {
		// A model shown a 5-hour allowance but no weekly one would read as though
		// the weekly limit did not exist, which is worse than showing nothing.
		const partial = QUOTA_TABLE.replace(
			'<td class="p-2">7,690</td>',
			'<td class="p-2">unlimited</td>',
		);
		const quotas = parseQuotaTable(PLAN_TABLE + partial);
		assert.equal(quotas.has(slugifyModelKey('DeepSeek V4.1 Flash')), false);
		// Its siblings are unaffected.
		assert.equal(quotas.get(slugifyModelKey('Grok 4.5'))?.perFiveHours, 64.7);
	});

	it('returns nothing when the page has no allowance table', () => {
		assert.equal(parseQuotaTable(PLAN_TABLE).size, 0);
	});
});

describe('parsePlanTable: allowance join', () => {
	it('attaches the allowance to the model row', () => {
		const rows = parsePlanTable(PAGE);
		const grok = rows.find((r) => r.slug === 'grok-4-5');
		assert.deepEqual(grok?.quota, { perFiveHours: 64.7, perWeek: 129, perMonth: 216 });
	});

	// The join is by display name, so it must not depend on the name being
	// already slug-shaped. Storing the raw lowercased name attached 13 of 41.
	it('joins on the display name, not on the slug', () => {
		const rows = parsePlanTable(PAGE);
		const attached = rows.filter((r) => r.quota !== undefined);
		assert.equal(
			attached.length,
			5,
			'every listed model except the one absent from the quota table',
		);
	});

	it('leaves the allowance absent for a model the table omits', () => {
		// Absent means the page said nothing, which is not the same as zero —
		// rendering 0 would claim the model is unusable.
		const rows = parsePlanTable(PAGE);
		const kimi = rows.find((r) => r.slug === 'kimi-k3');
		assert.ok(kimi, 'the model row itself is still parsed');
		assert.equal(kimi.quota, undefined);
	});

	it('still parses the model list when there is no allowance table', () => {
		// The table covers 41 of 53 models in reality, so its absence is normal.
		const rows = parsePlanTable(PLAN_TABLE);
		assert.equal(rows.length, 6);
		assert.equal(
			rows.every((r) => r.quota === undefined),
			true,
		);
		assert.ok(rows.length >= MIN_PLAN_MODELS * 0, 'guard rail constant still exported');
	});
});
