/**
 * Transport for the CLI reference page.
 *
 * Split from `cli-reference.ts` so the parsing rule stays free of the VS Code
 * API and can be unit-tested; this half owns the request and the trustworthiness
 * guard.
 */

import type { CancellationToken } from 'vscode';
import { logger } from './logger';
import { MIN_CLI_REFERENCE_IDS, parseCliReferenceIds } from './cli-reference';

export interface FetchCliReferenceOptions {
	/** Page URL, normally `${cliReferenceBaseUrl}/models`. */
	readonly url?: string;
	readonly token?: CancellationToken;
}

/**
 * Fetch the CLI reference page and return the canonical ids it lists.
 *
 * Returns `undefined` for every failure mode — offline, non-200, or a page that
 * yields fewer ids than `MIN_CLI_REFERENCE_IDS`. Callers treat that as "this id
 * source is unavailable" and fall back to the compiled registry, the cached
 * mapping, and finally the unsupported API catalog.
 *
 * A short parse is rejected rather than returned, because a partially-read page
 * would silently drop ids and leave models stuck on their bare slug.
 */
export async function fetchCliReferenceIds(
	options: FetchCliReferenceOptions = {},
): Promise<string[] | undefined> {
	const url = options.url;
	if (!url) {
		return undefined;
	}

	const controller = new AbortController();
	const cancel = options.token?.onCancellationRequested(() => controller.abort());

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: { Accept: 'text/html' },
			signal: controller.signal,
		});
		if (!response.ok) {
			logger.warn(`CLI reference ${url} returned HTTP ${response.status}`);
			return undefined;
		}

		const ids = parseCliReferenceIds(await response.text());
		if (ids.length < MIN_CLI_REFERENCE_IDS) {
			logger.warn(
				`CLI reference ${url} yielded ${ids.length} ids (< ${MIN_CLI_REFERENCE_IDS}); ` +
					'the page layout likely changed.',
			);
			return undefined;
		}

		logger.info(`CLI reference: ${ids.length} model ids from ${url}`);
		return ids;
	} catch (error) {
		if (!controller.signal.aborted) {
			logger.warn(`CLI reference fetch failed: ${url}`, error);
		}
		return undefined;
	} finally {
		cancel?.dispose();
	}
}
