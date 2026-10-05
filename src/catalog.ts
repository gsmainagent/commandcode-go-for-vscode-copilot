/**
 * Model catalog for the picker.
 *
 * ## Which source decides what
 *
 * **The Go plan page decides which models exist.** `docs/plans/go` is the
 * supported surface for Go subscribers: it states exactly what the plan includes,
 * along with capabilities, per-token prices, an intelligence score and context
 * windows. It is scraped HTML, though, and it went unparseable three times during
 * development, so it is treated as recoverable rather than authoritative.
 *
 * **Canonical ids are resolved from Go-supported sources only.**
 *
 * `/provider/v1/models` also serves ids, and an earlier build made it the
 * foundation. That was wrong: the Provider API is documented as unavailable to Go
 * subscribers — `docs/provider` states "Every plan except the Go plan has API
 * access", and its POST paths answer `403 Your Go plan doesn't include API
 * access`. Only the GET is ungated, so relying on it is a bet that an excluded
 * endpoint stays open. It is still consulted, last and opportunistically,
 * because it resolves the last unresolved slug and costs one request.
 *
 * The id sources, in order:
 *
 *   1. the compiled registry in `models.ts` — offline, always available
 *   2. the mapping cached from earlier runs
 *   3. `docs/reference/cli/models`, which lists ids as the CLI addresses them
 *   4. `/provider/v1/models` — unsupported on Go, opportunistic
 *
 * A slug that resolves to nothing keeps its bare slug and still appears in the
 * picker. The Generate API rejects a bare slug, so selecting it fails, but hiding
 * a model the plan says the subscriber has is the worse error.
 *
 * ## Degradation
 *
 * | plan page | id sources | result |
 * | --- | --- | --- |
 * | ok | any | every plan model, with capabilities and prices |
 * | ok | none resolve | every plan model, slugs as ids |
 * | fails | cached mapping | every plan model, previous metadata replayed |
 * | fails | nothing | curated registry only |
 *
 * A metadata outage never empties the picker and never silently strips vision
 * support from models that have it.
 */

import type { CancellationToken, Memento } from 'vscode';
import {
	COMMAND_CODE_CLIENT_VERSION,
	DEFAULT_CATALOG_BASE_URL,
	DEFAULT_CATALOG_REFRESH_MINUTES,
	DEFAULT_CLI_REFERENCE_BASE_URL,
	DEFAULT_PLAN_BASE_URL,
} from './consts';
import { logger } from './logger';
import { fetchCliReferenceIds } from './cli-reference-fetch';
import { fetchPlanCatalog } from './plan-catalog';
import { buildModelIdIndex, matchPlanRows, slugifyModelKey, type PlanPricing } from './plan-parse';
import { shouldRefresh } from './catalog-policy';
import type { ApiModelInfo } from './types';

/** Bump when the persisted snapshot shape changes. */
const CATALOG_STATE_VERSION = 'v4';

const CATALOG_STATE_KEY_PREFIX = 'commandcode-copilot.catalog';

/** A picker entry: the model id plus everything known about it. */
export interface CatalogModel {
	/** Canonical id the Generate API expects, e.g. `moonshotai/Kimi-K3`. */
	readonly id: string;
	/** Display name, from the plan page or the API catalog. */
	readonly name: string;
	/** Total context window in tokens, or 0 when no source stated one. */
	readonly contextLength: number;
	/**
	 * Vendor-declared vision support.
	 *
	 * `undefined` means nobody said — not "no vision". A declared `false` is
	 * authoritative and must not be overridden by the compiled table.
	 */
	readonly vision?: boolean;
	/** Vendor-declared reasoning support, same distinction. */
	readonly reasoning?: boolean;
	/** Prices in USD per million tokens, when the plan page stated them. */
	readonly pricing?: PlanPricing;
	/** The plan page's `Intelligence` index score, when it stated one. */
	readonly intelligence?: number;
	/**
	 * True when the id is a bare docs slug rather than a canonical one.
	 *
	 * Such a model is listed but not yet callable; the log names it so the gap is
	 * visible rather than silent.
	 */
	readonly unresolvedId?: boolean;
}

export interface LiveCatalog {
	/** Model id -> entry, ready for `toModelDefinition`. */
	readonly models: ReadonlyMap<string, CatalogModel>;
	/** Whether this call consulted the network. */
	readonly fromNetwork: boolean;
	/** Which sources produced the list, for logs and diagnostics. */
	readonly source: CatalogSource;
	/** True when a refresh was due and did not happen. */
	readonly stale: boolean;
}

export type CatalogSource =
	/** Plan page and at least one id source answered. */
	| 'plan+ids'
	/** Plan page answered but no id source resolved anything. */
	| 'plan-only'
	/** Plan page unreachable; the stored snapshot was replayed. */
	| 'cached'
	/** Nothing known at all. */
	| 'none';

/** Everything the plan page contributes, keyed by whatever id it resolved to. */
type MetadataIndex = ReadonlyMap<string, Omit<CatalogModel, 'id' | 'name' | 'contextLength'>>;

interface StoredSnapshot {
	readonly checkedAt: number;
	readonly models: CatalogModel[];
}

interface FetchResult {
	readonly models: CatalogModel[];
	/** True when the plan page supplied capabilities this run. */
	readonly metadataAvailable: boolean;
	/** True when any id source resolved at least one slug. */
	readonly idsResolved: boolean;
}

let sessionCache: ReadonlyMap<string, CatalogModel> | undefined;
/** Collapses concurrent first-run fetches onto one round of requests. */
let inFlight: Promise<FetchResult | undefined> | undefined;

function stateKey(planBaseUrl: string, cliReferenceBaseUrl: string): string {
	return `${CATALOG_STATE_KEY_PREFIX}:${CATALOG_STATE_VERSION}:${planBaseUrl}:${cliReferenceBaseUrl}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Rebuild a stored entry, dropping fields that lost their type in storage. */
function toCatalogModel(raw: unknown): CatalogModel | undefined {
	if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
		return undefined;
	}
	return {
		id: raw.id,
		name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
		contextLength:
			typeof raw.contextLength === 'number' && raw.contextLength > 0 ? raw.contextLength : 0,
		...(typeof raw.vision === 'boolean' ? { vision: raw.vision } : {}),
		...(typeof raw.reasoning === 'boolean' ? { reasoning: raw.reasoning } : {}),
		...(isRecord(raw.pricing) ? { pricing: raw.pricing as unknown as PlanPricing } : {}),
		...(typeof raw.intelligence === 'number' ? { intelligence: raw.intelligence } : {}),
		...(raw.unresolvedId === true ? { unresolvedId: true } : {}),
	};
}

function readSnapshot(globalState: Memento, key: string): StoredSnapshot | undefined {
	const raw = globalState.get<StoredSnapshot>(key);
	if (!raw || !Array.isArray(raw.models)) {
		return undefined;
	}
	const models = raw.models
		.map(toCatalogModel)
		.filter((model): model is CatalogModel => model !== undefined);
	return models.length > 0
		? { checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : 0, models }
		: undefined;
}

/**
 * Recover the plan-page contributions from a stored snapshot.
 *
 * This is also the second id source: a previously resolved id for the same
 * display name or slug is reused, which keeps ids working when every live source
 * is unreachable.
 */
function metadataFromSnapshot(stored: StoredSnapshot | undefined): MetadataIndex {
	const index = new Map<string, Omit<CatalogModel, 'id' | 'name' | 'contextLength'>>();
	for (const model of stored?.models ?? []) {
		const { id: _id, name: _name, contextLength: _contextLength, ...metadata } = model;
		if (Object.keys(metadata).length > 0) {
			index.set(model.id, metadata);
		}
	}
	return index;
}

/** Canonical ids recovered from a stored snapshot, for slug resolution. */
function idsFromSnapshot(stored: StoredSnapshot | undefined): string[] {
	return (stored?.models ?? []).filter((model) => !model.unresolvedId).map((model) => model.id);
}

async function persistSnapshot(
	globalState: Memento,
	key: string,
	snapshot: StoredSnapshot,
): Promise<void> {
	try {
		await globalState.update(key, snapshot);
	} catch (error) {
		logger.warn('Failed to persist model catalog snapshot', error);
	}
}

/**
 * Consult `/provider/v1/models` for ids the supported sources missed.
 *
 * Unsupported on Go: its POST paths answer `403 Your Go plan doesn't include API
 * access`, and only this GET is ungated. It is therefore last in the chain, and
 * every failure is silent — a 403, a timeout and a layout change all mean "no
 * extra ids", which is a state the caller already handles.
 */
async function fetchApiModelIds(
	baseUrl: string,
	apiKey: string | undefined,
	token?: CancellationToken,
): Promise<string[]> {
	if (!apiKey) {
		return [];
	}
	const controller = new AbortController();
	const cancel = token?.onCancellationRequested(() => controller.abort());
	try {
		const response = await fetch(`${baseUrl}/models`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'x-command-code-version': COMMAND_CODE_CLIENT_VERSION,
				'x-cli-environment': 'production',
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			return [];
		}
		const body = (await response.json()) as { data?: ApiModelInfo[] };
		return (body.data ?? [])
			.map((model) => model.id)
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
	} catch {
		return [];
	} finally {
		cancel?.dispose();
	}
}

interface FetchOptions {
	readonly planBaseUrl: string;
	readonly cliReferenceBaseUrl: string;
	readonly catalogBaseUrl: string;
	readonly apiKey: string | undefined;
	/** Ids the compiled registry knows, offline. */
	readonly registryIds: readonly string[];
	/** Plan-page contributions from the previous snapshot. */
	readonly cachedMetadata: MetadataIndex;
	/** Ids recovered from the previous snapshot. */
	readonly cachedIds: readonly string[];
	readonly token?: CancellationToken;
}

async function fetchSnapshot(options: FetchOptions): Promise<FetchResult | undefined> {
	const rows = await fetchPlanCatalog({
		planBaseUrl: options.planBaseUrl,
		token: options.token,
	});
	if (!rows) {
		return undefined;
	}

	// Chain the id sources cheapest-first. `buildModelIdIndex` takes the first
	// writer for a key, so order here is priority order.
	const supportedIds = buildModelIdIndex([
		...options.registryIds,
		...options.cachedIds,
		...((await fetchCliReferenceIds({
			url: `${options.cliReferenceBaseUrl.replace(/\/+$/, '')}/models`,
			token: options.token,
		})) ?? []),
	]);
	const beforeUnsupported = rows.filter((row) =>
		supportedIds.has(slugifyModelKey(row.slug)),
	).length;

	// Last resort, and unsupported on this plan. Only worth a request when the
	// supported sources left something unresolved.
	let matched = matchPlanRows(rows, supportedIds.keys());
	if (matched.some((model) => model.id === model.slug)) {
		const extraIds = await fetchApiModelIds(options.catalogBaseUrl, options.apiKey, options.token);
		if (extraIds.length > 0) {
			matched = matchPlanRows(rows, [...supportedIds.values(), ...extraIds]);
		}
	}

	const models: CatalogModel[] = [];
	for (const row of matched) {
		const unresolved = row.id === row.slug;
		models.push({
			id: row.id,
			name: row.name || row.id,
			contextLength: row.contextLength ?? 0,
			...(row.caps ? { vision: row.caps.vision, reasoning: row.caps.reasoning } : {}),
			...(row.pricing ? { pricing: row.pricing } : {}),
			...(row.intelligence !== undefined ? { intelligence: row.intelligence } : {}),
			...(unresolved ? { unresolvedId: true } : {}),
		});
	}

	// Ids the previous snapshot knew but this run did not resolve still carry
	// their metadata, so a temporary source outage does not strip capabilities.
	for (const model of models) {
		if (model.vision !== undefined || model.pricing !== undefined) {
			continue;
		}
		const fallback = options.cachedMetadata.get(model.id);
		if (fallback) {
			Object.assign(model, fallback);
		}
	}

	const unresolved = models.filter((model) => model.unresolvedId);
	const resolvedFromSupported = beforeUnsupported;
	logger.info(
		`Catalog: ${models.length} plan models, ${resolvedFromSupported} ids from Go-supported sources` +
			(unresolved.length > 0
				? `, ${unresolved.length} unresolved: ${unresolved.map((m) => m.id).join(', ')}`
				: ''),
	);

	return {
		models,
		metadataAvailable: models.some((model) => model.vision !== undefined),
		idsResolved: models.some((model) => !model.unresolvedId),
	};
}

export interface GetLiveCatalogOptions {
	readonly globalState: Memento;
	/** Canonical ids the compiled registry knows, so resolution works offline. */
	readonly registryIds?: readonly string[];
	/** API key, needed only for the unsupported id source. */
	readonly apiKey?: string;
	readonly planBaseUrl?: string;
	readonly cliReferenceBaseUrl?: string;
	readonly catalogBaseUrl?: string;
	readonly token?: CancellationToken;
	/** Explicit "Refresh Models": ignore the timestamp and refetch. */
	readonly forceRefresh?: boolean;
	/** Minutes before a stored snapshot is refetched. */
	readonly refreshMinutes?: number;
}

const EMPTY: LiveCatalog = {
	models: new Map(),
	fromNetwork: false,
	source: 'none',
	stale: false,
};

/**
 * Resolve the catalog for the picker.
 *
 * Never throws. Returns an empty catalog when nothing is known, in which case
 * the caller falls back to the curated registry in `models.ts`.
 */
export async function getLiveCatalog(options: GetLiveCatalogOptions): Promise<LiveCatalog> {
	const planBaseUrl = options.planBaseUrl ?? DEFAULT_PLAN_BASE_URL;
	const cliReferenceBaseUrl = options.cliReferenceBaseUrl ?? DEFAULT_CLI_REFERENCE_BASE_URL;
	const refreshMinutes =
		options.refreshMinutes && options.refreshMinutes > 0
			? options.refreshMinutes
			: DEFAULT_CATALOG_REFRESH_MINUTES;
	const key = stateKey(planBaseUrl, cliReferenceBaseUrl);

	// Fast path: this session already resolved the list.
	if (!options.forceRefresh && sessionCache) {
		return { models: sessionCache, fromNetwork: false, source: 'cached', stale: false };
	}

	const stored = readSnapshot(options.globalState, key);
	const refresh = shouldRefresh({
		checkedAt: stored?.checkedAt,
		refreshMinutes,
		forceRefresh: options.forceRefresh === true,
		now: Date.now(),
	});

	let snapshot = stored;
	let fromNetwork = false;
	let source: CatalogSource = 'cached';

	if (refresh) {
		inFlight ??= fetchSnapshot({
			planBaseUrl,
			cliReferenceBaseUrl,
			catalogBaseUrl: options.catalogBaseUrl ?? DEFAULT_CATALOG_BASE_URL,
			apiKey: options.apiKey,
			registryIds: options.registryIds ?? [],
			cachedMetadata: metadataFromSnapshot(stored),
			cachedIds: idsFromSnapshot(stored),
			token: options.token,
		}).finally(() => {
			inFlight = undefined;
		});
		const fetched = await inFlight;
		if (fetched) {
			snapshot = { checkedAt: Date.now(), models: fetched.models };
			fromNetwork = true;
			source = fetched.metadataAvailable
				? fetched.idsResolved
					? 'plan+ids'
					: 'plan-only'
				: 'cached';
			await persistSnapshot(options.globalState, key, snapshot);
		} else if (!stored) {
			logger.warn('Plan page unavailable; falling back to the curated registry');
			return EMPTY;
		} else {
			logger.warn(
				`Plan page unavailable; replaying ${stored.models.length} cached models. ` +
					'Capabilities may be out of date.',
			);
			source = 'cached';
		}
	}

	if (!snapshot || snapshot.models.length === 0) {
		return EMPTY;
	}

	const models = new Map(snapshot.models.map((model) => [model.id, model]));
	sessionCache = models;
	return {
		models,
		fromNetwork,
		source,
		// A refresh was due and did not happen, so this list may be out of date.
		stale: refresh && !fromNetwork,
	};
}

/** Drop the in-memory cache. Used by the deactivate path and by tests. */
export function resetCatalogCache(): void {
	sessionCache = undefined;
	inFlight = undefined;
}
