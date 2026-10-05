import { DEFAULT_BASE_URL } from './consts';

export const OFFICIAL_COMMANDCODE_HOST = 'api.commandcode.ai';

/**
 * Returns true when the given base URL points at the official Command Code
 * host. Used for documentation and UI references that are only valid for
 * first-party usage.
 */
export function isOfficialBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase() === OFFICIAL_COMMANDCODE_HOST;
	} catch {
		return false;
	}
}

/** Strip trailing slashes so callers can join paths freely. */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/u, '');
}

/** Default Generate API base URL for documentation/UI references. */
export function getDefaultBaseUrl(): string {
	return DEFAULT_BASE_URL;
}
