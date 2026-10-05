/**
 * Refresh policy for the model list, kept free of VS Code and network imports
 * so it can be unit-tested directly.
 *
 * The rule is one line: refetch when there is nothing cached, when the user
 * asked for it, or when the cached copy has aged out. Everything else about
 * *where* the list comes from lives in `catalog.ts`.
 */

/** Default interval, mirrored from `DEFAULT_CATALOG_REFRESH_MINUTES`. */
export const DEFAULT_REFRESH_MINUTES = 30;

export interface RefreshDecisionInput {
	/** Timestamp of the stored snapshot, or `undefined` when none exists. */
	readonly checkedAt: number | undefined;
	/** Configured interval in minutes. */
	readonly refreshMinutes: number;
	/** The user ran "Refresh Models". */
	readonly forceRefresh: boolean;
	/** Injectable clock, so tests do not depend on wall time. */
	readonly now: number;
}

/**
 * Decide whether the stored snapshot must be replaced.
 *
 * A missing or malformed timestamp counts as stale, so a corrupted cache heals
 * itself on the next read instead of pinning the picker to whatever was saved.
 */
export function shouldRefresh(input: RefreshDecisionInput): boolean {
	if (input.forceRefresh) {
		return true;
	}
	if (input.checkedAt === undefined) {
		return true;
	}
	const intervalMs = Math.max(1, input.refreshMinutes) * 60_000;
	return input.now - input.checkedAt > intervalMs;
}

/**
 * Describe a snapshot for the logs: fresh, aged out, or never fetched.
 */
export function snapshotAge(
	checkedAt: number | undefined,
	now: number,
): 'missing' | 'fresh' | 'expired' {
	if (checkedAt === undefined) {
		return 'missing';
	}
	return now - checkedAt > DEFAULT_REFRESH_MINUTES * 60_000 ? 'expired' : 'fresh';
}
