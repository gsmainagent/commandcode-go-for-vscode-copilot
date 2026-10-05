/**
 * Transport for the API model catalog.
 *
 * Split from `catalog.ts` so the rule stays free of the VS Code API and can be
 * unit-tested; this half owns the request only.
 */

import type { CancellationToken } from 'vscode';
import { COMMAND_CODE_CLIENT_VERSION } from './consts';
import type { ApiModelInfo } from './types';

export interface FetchApiModelIdsOptions {
	readonly baseUrl: string;
	readonly apiKey: string | undefined;
	readonly token?: CancellationToken;
}

/**
 * Fetch canonical model ids from the API catalog.
 *
 * Unsupported on Go: its POST paths answer `403 Your Go plan doesn't include API
 * access`, and only this GET is ungated. It is therefore last in the chain, and
 * every failure is silent — a 403, a timeout and a layout change all mean "no
 * extra ids", which is a state the caller already handles.
 *
 * ## The key is optional, and that is load-bearing
 *
 * This endpoint answers `200` with 85 usable ids when called without any
 * credentials (measured 2026-10-05). Requiring a key here therefore discarded
 * the last remaining id source for no reason, and the fallback is not graceful:
 * a plan row whose id cannot be resolved keeps its bare slug, and a bare slug is
 * refused upstream as
 *
 *     Model/provider not recognized: anthropic:<slug>
 *
 * so the whole picker — 53 of 53 models — failed at once, one identical error
 * each, with the cause pointing at the model name rather than at the missing
 * credential.
 *
 * That guard was written when the endpoint was assumed to need auth. The
 * key is still sent when present, since it can only widen the answer.
 */
export async function fetchApiModelIds(options: FetchApiModelIdsOptions): Promise<string[]> {
	const { baseUrl, apiKey, token } = options;
	const controller = new AbortController();
	const cancel = token?.onCancellationRequested(() => controller.abort());
	try {
		const response = await fetch(`${baseUrl}/models`, {
			method: 'GET',
			headers: {
				// Omitted rather than sent empty when there is no key: an empty
				// bearer can be read as a malformed credential instead of none.
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				'x-command-code-version': COMMAND_CODE_CLIENT_VERSION,
				'x-cli-environment': 'production',
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			return [];
		}
		const body = (await response.json()) as { data?: ApiModelInfo[] };
		// Each entry is checked rather than assumed: a `null` in the array would
		// make the mapping throw, the `catch` would swallow it, and the whole
		// response would be discarded — 85 good ids lost to one bad row. That is
		// the same silent-degradation shape as the missing-key bug above, so it
		// gets the same treatment.
		return (Array.isArray(body.data) ? body.data : [])
			.map((model) => (model && typeof model === 'object' ? model.id : undefined))
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
	} catch {
		return [];
	} finally {
		cancel?.dispose();
	}
}
