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

/**
 * Normalize a user-supplied upstream proxy URL, or return `undefined` if it
 * cannot be used.
 *
 * ## Why this validates instead of passing the value through
 *
 * `proxy.mjs` validates `upstreamProxy` at boot and **refuses to start** when it
 * is not an `http://` URL:
 *
 *     Invalid upstreamProxy, refusing to start
 *
 * That check exists so a typo cannot degrade into one opaque 502 per request. It
 * also means a malformed value here would take down *every* model in the picker,
 * not just the one the user was trying to fix — so the value is dropped and the
 * request goes direct, which is the state the extension already worked in.
 *
 * ## Why `socks5://` is rejected rather than translated
 *
 * The proxy implements HTTP CONNECT and nothing else. Clash's mixed port (7897
 * by default) answers both SOCKS5 and HTTP CONNECT on the same port, so the
 * correct value for it is the `http://` form. Rejecting `socks5://` is therefore
 * not a lost capability, just a spelling that cannot work here.
 *
 * ## Why the setting exists at all
 *
 * `proxy.mjs` reads `CC_UPSTREAM_PROXY` and nothing else. It deliberately does
 * not read `HTTP_PROXY` or `HTTPS_PROXY`, because Node's native `fetch` ignores
 * them; the official environment-variable route needs `NODE_USE_ENV_PROXY=1`
 * plus a recent Node runtime. A user behind a regional or corporate proxy
 * therefore had no supported way to route these requests.
 */
export function normalizeUpstreamProxy(raw: string | undefined): string | undefined {
	const trimmed = raw?.trim() ?? '';
	if (trimmed === '') {
		return undefined;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return undefined;
	}

	// Only http:, which is what the CONNECT implementation speaks.
	if (parsed.protocol !== 'http:') {
		return undefined;
	}

	// Assembled by hand rather than via `URL.toString()`: that appends a trailing
	// slash to a bare authority, and drops an explicit `:80` because 80 is the
	// default for the scheme. Both make the stored value differ from what the
	// user typed, for no benefit — `proxy.mjs` parses host and port out of it.
	const credentials = parsed.username
		? `${decodeURIComponent(parsed.username)}${
				parsed.password ? `:${decodeURIComponent(parsed.password)}` : ''
			}@`
		: '';
	// Defaulted explicitly so the value states where it connects. A local proxy
	// is never on 80, and leaving it implicit hides a probable misconfiguration.
	const port = parsed.port === '' ? '80' : parsed.port;

	return `http://${credentials}${parsed.hostname}:${port}`;
}
