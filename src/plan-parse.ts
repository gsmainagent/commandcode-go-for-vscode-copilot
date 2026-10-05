/**
 * Parse the Command Code plan page into structured model rows.
 *
 * Pure functions with no VS Code or network dependency, so the parsing rules
 * can be tested directly — the regexes here are the part most likely to break
 * when the docs site changes.
 *
 * `https://commandcode.ai/docs/plans/go` is a server-rendered table whose `Caps`
 * column states each model's capabilities verbatim in an aria-label, e.g.
 * `Capabilities: Text input, Vision, Reasoning`. That is the vendor's own
 * statement, so it beats inferring capabilities by probing.
 *
 * Guard rail: `MIN_PLAN_MODELS` exists so a layout change yields *no* models
 * rather than a wrong or partial list. A partial parse would silently mark
 * models text-only, which is worse than falling back to the API catalog.
 */

import type { PlanPricing, PlanQuota } from './types';

/** A plan page yielding fewer models than this is treated as a parse failure. */
export const MIN_PLAN_MODELS = 20;

export type { PlanPricing, PlanQuota } from './types';

export interface PlanModelRow {
	/** Docs slug, e.g. `kimi-k3`. */
	readonly slug: string;
	/** Display name as printed in the table, e.g. `Kimi K3`. */
	readonly name: string;
	/**
	 * Vendor-declared capabilities.
	 *
	 * `undefined` means the row carried no `Caps` label at all, which is
	 * different from a label that omits Vision. Callers must not read an absent
	 * declaration as `false`.
	 */
	readonly caps: PlanCapabilities | undefined;
	/** Total context window in tokens, when the table states one. */
	readonly contextLength: number | undefined;
	/** Per-million-token prices, when the row states them. */
	readonly pricing: PlanPricing | undefined;
	/** The `Intelligence` column, an index score, or `undefined`. */
	readonly intelligence: number | undefined;
	/** Request allowances, when the page's quota table lists this model. */
	readonly quota: PlanQuota | undefined;
}

export interface PlanCapabilities {
	readonly vision: boolean;
	readonly reasoning: boolean;
}

export interface PlanModel extends PlanModelRow {
	/** Canonical API model id, e.g. `moonshotai/Kimi-K3`. */
	readonly id: string;
}

/**
 * Normalize a model id or docs slug to a comparable key.
 *
 * The two sides differ only in punctuation: the catalog serves
 * `deepseek/deepseek-v4.1-flash-fast` and `inclusionai/ling-3.1-flash:free`
 * while the docs link `deepseek-v4-1-flash-fast` and `ling-3-1-flash-free`.
 */
export function slugifyModelKey(value: string): string {
	let out = value.toLowerCase();
	for (const char of ['.', '/', '_', ':', '+']) {
		out = out.replaceAll(char, '-');
	}
	while (out.includes('--')) {
		out = out.replaceAll('--', '-');
	}
	return out.replace(/^-+|-+$/g, '');
}

/** Billing qualifiers the docs drop but the catalog keeps. */
const BILLING_SUFFIXES = ['-paid', '-free', '-usd', '-credits'];

function billingVariants(key: string): string[] {
	return BILLING_SUFFIXES.filter((suffix) => key.endsWith(suffix)).map((suffix) =>
		key.slice(0, -suffix.length),
	);
}

/**
 * Build a slug -> canonical id lookup.
 *
 * Indexes two keys per id — the bare tail (`hy3-paid`) and the vendor-qualified
 * slug (`tencent-hy3-paid`) — plus each with its billing suffix removed, because
 * the docs table mixes all of these forms. Without the variants a model the plan
 * includes can silently vanish from the picker.
 */
export function buildModelIdIndex(knownIds: Iterable<string>): Map<string, string> {
	const index = new Map<string, string>();
	const remember = (key: string, id: string): void => {
		// First writer wins so a `/v1` and `/v2` pair cannot flip between runs.
		if (!index.has(key)) {
			index.set(key, id);
		}
	};

	for (const id of knownIds) {
		const keys = new Set([slugifyModelKey(id.split('/').pop() ?? id), slugifyModelKey(id)]);
		for (const key of keys) {
			remember(key, id);
			for (const variant of billingVariants(key)) {
				remember(variant, id);
			}
		}
	}
	return index;
}

/** Parse a context cell such as `1M`, `262K`, `1.1M` into tokens. */
export function parseContextTokens(text: string): number | undefined {
	const match = /^(\d+(?:\.\d+)?)\s*([KM])?$/i.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	const unit = (match[2] ?? '').toUpperCase();
	const multiplier = unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
	return Math.round(value * multiplier);
}

/** Parse a leading USD amount such as `$0.16` or `$1.16M`. */
function parseUsd(text: string): number | undefined {
	const match = /\$([\d.]+)/.exec(text);
	if (!match) {
		return undefined;
	}
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

/** Which price column a cell represents, taken from its `aria-label`. */
type PriceKind = keyof Omit<PlanPricing, 'peakWindow' | 'offPeakHoursPerDay'>;

const PRICE_KINDS: ReadonlyArray<readonly [RegExp, PriceKind]> = [
	[/cache\s*write\s*:/i, 'cacheWrite'],
	[/cache\s*read\s*:/i, 'cacheRead'],
	[/\binput\s*:/i, 'input'],
	[/\boutput\s*:/i, 'output'],
];

/** The Caps cell carries `Text input` in its label; it is not a price column. */
const CAPS_LABEL_MARKER = /^Capabilities\s*:/i;

/** Peak pricing and the window it applies to, from a cell's `aria-label`. */
interface PeakHint {
	readonly price: number;
	readonly window: string;
}

function parsePeakHint(ariaLabel: string): PeakHint | undefined {
	const peak = /during peak hours(?:,\s*([^"]*))?/i.exec(ariaLabel);
	if (!peak) {
		return undefined;
	}
	const price = parseUsd(ariaLabel.slice(0, peak.index));
	return price === undefined ? undefined : { price, window: peak[1]?.trim() ?? '' };
}

/**
 * Pull the off-peak window from the model cell's tooltip.
 *
 * The cell reads `Off-peak shown (17h/day) · peak $0.32 / $1.16 01–04 & 06–10
 * UTC, Mon–Fri`. Only the hours-per-day figure is taken from here; the peak
 * numbers it repeats are already captured per price column, which is where the
 * table states them authoritatively.
 */
function parseOffPeakHours(text: string): number | undefined {
	const match = /(\d+)\s*h\/day/i.exec(text);
	return match ? Number(match[1]) : undefined;
}

/** The `Intelligence` column: an index score, or a placeholder. */
function parseIntelligence(text: string): number | undefined {
	const match = /^\d+(?:\.\d+)?$/.exec(text.trim()) ? /^(\d+(?:\.\d+)?)$/.exec(text.trim()) : null;
	return match ? Number(match[1]) : undefined;
}

/** Undo the entity escaping the docs apply to attribute values. */
function decodeEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
	return html
		.replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Extract every model row from a plan page's table.
 *
 * Returns an empty array when the table is absent, so callers can distinguish
 * "layout changed" from "plan has no models".
 *
 * Cells are identified by what they *say*, not by their position: price columns
 * carry `input:` / `output:` / `cache read:` in their `aria-label`, the context
 * column is the only one holding a bare size, and `Intelligence` holds either a
 * bare number or `not yet scored`. Positional parsing would break silently the
 * next time a column is inserted.
 */
/** What a table column holds, derived from its header label. */
type ColumnRole =
	| 'model'
	| 'context'
	| 'intelligence'
	| 'input'
	| 'output'
	| 'cacheRead'
	| 'cacheWrite'
	| 'caps'
	| 'other';

function classifyHeader(label: string): ColumnRole {
	const lower = label.toLowerCase();
	if (lower.startsWith('model')) {
		return 'model';
	}
	if (lower.startsWith('context')) {
		return 'context';
	}
	if (lower.startsWith('intelligence')) {
		return 'intelligence';
	}
	if (lower.startsWith('input')) {
		return 'input';
	}
	if (lower.startsWith('output')) {
		return 'output';
	}
	if (lower.startsWith('cache read')) {
		return 'cacheRead';
	}
	if (lower.startsWith('cache write')) {
		return 'cacheWrite';
	}
	if (lower.startsWith('caps')) {
		return 'caps';
	}
	return 'other';
}

/**
 * Read the column roles from the table header.
 *
 * Needed because most rows label their price cells only `N context price bands`,
 * which names no column. The visible text still carries the base rate, so the
 * header is what says which rate it is. Falls back to an empty list, in which
 * case per-cell `aria-label` classification is the only signal available.
 */
function parseHeaderRoles(table: string): ColumnRole[] {
	const thead = /<thead\b[\s\S]*?<\/thead>/i.exec(table)?.[0];
	if (!thead) {
		return [];
	}
	return (thead.match(/<th\b[\s\S]*?<\/th>/gi) ?? []).map((cell) =>
		classifyHeader(stripTags(cell)),
	);
}

/**
 * Extract every model row from a plan page's table.
 *
 * Returns an empty array when the table is absent, so callers can distinguish
 * "layout changed" from "plan has no models".
 *
 * Columns are resolved from the table header, not from cell position, because
 * only 15 of 53 rows name their price column in an `aria-label`; the rest say
 * `N context price bands` and are identifiable only by where they sit under
 * `Input` / `Output` / `Cache read` / `Cache write`.
 */
export function parsePlanTable(html: string): PlanModelRow[] {
	const table = /<table\b[\s\S]*?<\/table>/i.exec(html)?.[0];
	if (!table) {
		return [];
	}

	// A second table on the page carries request allowances, keyed by display
	// name. Its absence is normal — it covers 41 of the 53 models — so a model
	// with no entry simply has no stated allowance.
	const quotas = parseQuotaTable(html);
	const headerRoles = parseHeaderRoles(table);

	// The Context and Intelligence columns are identifiable only from the header:
	// nothing in the cells themselves distinguishes "1M" (a window) from "43.6"
	// (a score). Without a header those two would parse as zero rows of context
	// and no intelligence, which is exactly the partial result this module
	// promises never to return. Fail instead, so the caller falls back to cached
	// metadata rather than silently dropping fields.
	if (headerRoles.length === 0) {
		return [];
	}

	const rows: PlanModelRow[] = [];
	for (const rowHtml of table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
		const slug = /\/models\/([a-z0-9][a-z0-9.-]*)/i.exec(rowHtml)?.[1];
		if (!slug) {
			continue;
		}

		const capsLabel = /aria-label="Capabilities:\s*([^"]*)"/i.exec(rowHtml)?.[1]?.trim();
		const lower = capsLabel?.toLowerCase() ?? '';
		const caps =
			capsLabel === undefined
				? undefined
				: { vision: lower.includes('vision'), reasoning: lower.includes('reasoning') };

		let name = '';
		let contextLength: number | undefined;
		let intelligence: number | undefined;
		let offPeakHoursPerDay: number | undefined;
		const prices: Partial<Record<PriceKind, number>> = {};
		const peaks: Partial<Record<PriceKind, PeakHint>> = {};
		let peakWindow: string | undefined;

		const cells = rowHtml.match(/<td\b[\s\S]*?<\/td>/gi) ?? [];
		for (const [index, cell] of cells.entries()) {
			const text = stripTags(cell);
			const aria = /aria-label="([^"]*)"/.exec(cell)?.[1] ?? '';
			const tooltip = /title="([^"]*)"/.exec(cell)?.[1] ?? '';

			// The header is authoritative when it has an opinion; the per-cell
			// aria-label is the fallback for rows that name their own column.
			// A `/models/` link is the model column by definition, so this is
			// checked before the header: the fixture table in the tests has no
			// `<thead>`, and a headerless table must still parse.
			const isModelCell = /\/models\//.test(cell);
			const headerRole = headerRoles[index] ?? 'other';
			const ariaRole = CAPS_LABEL_MARKER.test(aria)
				? 'caps'
				: (PRICE_KINDS.find(([pattern]) => pattern.test(aria))?.[1] ?? 'other');
			const role = isModelCell ? 'model' : headerRole !== 'other' ? headerRole : ariaRole;

			switch (role) {
				case 'model': {
					if (name) {
						break;
					}
					// The cell also holds the off-peak/peak summary button, so read
					// the anchor's own text rather than the whole cell.
					const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/i.exec(cell)?.[0];
					name = stripTags(anchor ?? cell);
					offPeakHoursPerDay = parseOffPeakHours(tooltip || aria);
					peakWindow ??= parsePeakHint(tooltip || aria)?.window || undefined;
					break;
				}
				case 'context':
					contextLength ??= parseContextTokens(text);
					break;
				case 'intelligence':
					intelligence ??= parseIntelligence(text);
					break;
				case 'input':
				case 'output':
				case 'cacheRead':
				case 'cacheWrite': {
					const kind = role as PriceKind;
					// A deal cell states "Free — view deal details"; the rate is $0.
					const isFree = /^free\b/i.test(aria) || text.toLowerCase() === 'free';
					prices[kind] = isFree ? 0 : parseUsd(text);
					const peak = parsePeakHint(aria);
					if (peak) {
						peaks[kind] = peak;
						peakWindow ??= peak.window || undefined;
					}
					break;
				}
				default:
					break;
			}
		}

		const hasPricing = Object.values(prices).some((v) => v !== undefined);
		const pricing = hasPricing
			? {
					input: prices.input,
					output: prices.output,
					cacheRead: prices.cacheRead,
					cacheWrite: prices.cacheWrite,
					...(peaks.input ? { peakInput: peaks.input.price } : {}),
					...(peaks.output ? { peakOutput: peaks.output.price } : {}),
					...(peaks.cacheRead ? { peakCacheRead: peaks.cacheRead.price } : {}),
					...(peakWindow ? { peakWindow: decodeEntities(peakWindow) } : {}),
					...(offPeakHoursPerDay !== undefined ? { offPeakHoursPerDay } : {}),
				}
			: undefined;

		const displayName = name || slug;
		rows.push({
			slug: slug.toLowerCase(),
			name: displayName,
			caps,
			contextLength,
			pricing,
			intelligence,
			quota: quotas.get(slugifyModelKey(displayName)),
		});
	}

	return rows;
}

/** Header label that identifies the allowance table. */
const QUOTA_HEADER_MARKER = /requests\s*\/\s*5\s*hours/i;

/**
 * Parse a request-count cell such as `4,620` or `81.4`.
 *
 * Thousands separators are stripped, and a fractional value is kept as-is: the
 * page prints `81.4`, `64.7` and `93.3` for three models where every other row is
 * a whole number, and those figures double and redouble in step with the integer
 * rows, so they are real counts rather than thousands.
 */
function parseRequestCount(text: string): number | undefined {
	const match = /^([\d,]+(?:\.\d+)?)$/.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const value = Number(match[1].replace(/,/g, ''));
	return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Parse the plan page's request-allowance table.
 *
 * This is a second table, separate from the model list that `parsePlanTable`
 * reads, so it is located by its own header rather than by position. Results are
 * keyed by the display name the page prints, which is the only identifier the two
 * tables share.
 *
 * A row with any unreadable figure is dropped rather than partially recorded: a
 * model shown a 5-hour allowance but no weekly one would read as though the
 * weekly limit did not exist.
 */
export function parseQuotaTable(html: string): Map<string, PlanQuota> {
	const quotas = new Map<string, PlanQuota>();

	for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
		const table = match[0];
		if (!QUOTA_HEADER_MARKER.test(stripTags(table))) {
			continue;
		}
		for (const rowMatch of table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
			const cells = (rowMatch.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) ?? []).map((cell) =>
				decodeEntities(stripTags(cell)),
			);
			if (cells.length < 4) {
				continue;
			}
			// The first cell is the display name; the rest are request counts.
			const name = cells[0].trim();
			const [perFiveHours, perWeek, perMonth] = cells.slice(1).map(parseRequestCount);
			if (!name || perFiveHours === undefined || perWeek === undefined || perMonth === undefined) {
				continue;
			}
			// Same key the model rows are looked up with. Storing the raw
			// lowercased name instead attached only 13 of 41 allowances, because
			// `DeepSeek V4 Flash` and `deepseek-v4-flash` are different strings.
			quotas.set(slugifyModelKey(name), { perFiveHours, perWeek, perMonth });
		}
		break;
	}

	return quotas;
}

/**
 * Map plan rows onto canonical API model ids.
 *
 * A row whose slug matches nothing keeps its bare slug as the id. The plan page
 * is refreshed on a timer, so a model that appears on the page before the API
 * catalog lists it is reachable as soon as the catalog catches up — and until
 * then it costs the user one failed request rather than hiding a model the plan
 * says they have. A picker that hides models is worse than one that lists a
 * model which turns out to be unavailable.
 */
export function matchPlanRows(
	rows: readonly PlanModelRow[],
	knownIds: Iterable<string>,
): PlanModel[] {
	const index = buildModelIdIndex(knownIds);
	const matched: PlanModel[] = [];
	for (const row of rows) {
		matched.push({ ...row, id: index.get(slugifyModelKey(row.slug)) ?? row.slug });
	}
	return matched;
}
