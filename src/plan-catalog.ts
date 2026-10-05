/**
 * Fetch and parse the Command Code Go plan page.
 *
 * The parsing itself lives in `plan-parse.ts` as pure functions so it can be
 * tested without a network; this module only handles transport and the guard
 * that decides whether a parse is trustworthy.
 */

import type { CancellationToken } from 'vscode';
import { DEFAULT_PLAN_BASE_URL, SUPPORTED_PLAN } from './consts';
import { logger } from './logger';
import { MIN_PLAN_MODELS, parsePlanTable, type PlanModelRow } from './plan-parse';

export interface FetchOptions {
	readonly planBaseUrl?: string;
	readonly token?: CancellationToken;
	/** Share one in-flight request instead of issuing a second. */
	readonly dedupe?: boolean;
}

let inFlight: Promise<PlanModelRow[] | undefined> | undefined;

/**
 * Fetch the plan page and return its model rows.
 *
 * Returns `undefined` for every failure mode — offline, non-200, no table, or
 * fewer rows than `MIN_PLAN_MODELS`. Callers treat that as "no plan data" and
 * fall back to the curated registry. A partial parse is never returned, because
 * rows missing from the table would be treated as lacking capabilities and so
 * silently marked text-only.
 */
export async function fetchPlanCatalog(
	options: FetchOptions = {},
): Promise<PlanModelRow[] | undefined> {
	if (options.dedupe !== false) {
		inFlight ??= doFetch(options).finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	}
	return doFetch(options);
}

async function doFetch(options: FetchOptions): Promise<PlanModelRow[] | undefined> {
	const base = (options.planBaseUrl ?? DEFAULT_PLAN_BASE_URL).replace(/\/+$/, '');
	const url = `${base}/${SUPPORTED_PLAN}`;

	const controller = new AbortController();
	const cancel = options.token?.onCancellationRequested(() => controller.abort());

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: { Accept: 'text/html' },
			signal: controller.signal,
		});
		if (!response.ok) {
			logger.warn(`Plan page ${url} returned HTTP ${response.status}`);
			return undefined;
		}

		const rows = parsePlanTable(await response.text());
		if (rows.length < MIN_PLAN_MODELS) {
			logger.warn(
				`Plan page ${url} yielded ${rows.length} rows (< ${MIN_PLAN_MODELS}); ` +
					'the page layout likely changed. Falling back to the curated registry.',
			);
			return undefined;
		}

		const declared = rows.filter((row) => row.caps !== undefined).length;
		logger.info(`Plan page: ${rows.length} models parsed from ${url} (${declared} with caps)`);
		return rows;
	} catch (error) {
		if (!controller.signal.aborted) {
			logger.warn(`Plan page fetch failed: ${url}`, error);
		}
		return undefined;
	} finally {
		cancel?.dispose();
	}
}

/** Reset the in-flight dedupe slot. Used by the deactivate path and tests. */
export function resetPlanCatalogCache(): void {
	inFlight = undefined;
}
