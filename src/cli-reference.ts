/**
 * Read canonical model ids out of the CLI reference page markup.
 *
 * Pure string handling with no VS Code and no network, so the parsing rule can
 * be unit-tested against saved markup. Transport lives in
 * `cli-reference-fetch.ts`, mirroring the `plan-parse` / `plan-catalog` split.
 *
 * `https://commandcode.ai/docs/reference/cli/models` documents the models the
 * Command Code CLI can select and lists them the way the CLI addresses them:
 * `moonshotai/Kimi-K3`, `tencent/hy3-paid`. That makes it the supported id source
 * on the Go plan, which the API catalog is not — see `catalog.ts`.
 *
 * Two properties matter and are easy to lose:
 *
 *   - **Casing is preserved.** Requests address `moonshotai/Kimi-K3` exactly;
 *     lowercasing it produces `403 Model/provider not recognized`.
 *   - **Billing qualifiers are preserved.** `hy3-paid` and `hy3-free` are
 *     different models, and `:free` marks a tier rather than a variant.
 */

/** Below this, the page shape must have changed and the result is discarded. */
export const MIN_CLI_REFERENCE_IDS = 10;

/**
 * Shape of an id as the CLI writes it: a vendor prefix, then a model name that
 * may carry a billing qualifier (`hy3-paid`) or a tier marker (`:free`).
 */
const ID_TOKEN = /[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9.:_-]{2,}/gi;

/**
 * Marks an id the vendor intends as copyable.
 *
 * The page also contains paths and URLs — `chat/completions`,
 * `~/.commandcode/auth.json`, the API base — and token shape alone cannot tell
 * them apart from a model id. Every real id is followed by its copy control, so
 * that is the discriminator.
 */
const COPY_MARKER = /copy model id/i;

/** Tokens that look like ids but are not models. */
const NOT_A_MODEL = [
	/^https?:/i,
	/^chat\//i,
	/^v\d\//i,
	/^\.?\.*\//,
	/\.json$/i,
	/\.example/i,
	/\.local$/i,
];

/**
 * Extract canonical model ids from the CLI reference page.
 *
 * Returns ids in document order, deduplicated.
 */
export function parseCliReferenceIds(html: string): string[] {
	const text = html
		.replace(/<script[\s\S]*?<\/script>/g, ' ')
		.replace(/<style[\s\S]*?<\/style>/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');

	const found: string[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(ID_TOKEN)) {
		const token = match[0];
		// Case-insensitive: the marker is rendered as "Copy model id" on the page
		// but appears in other casings as the page is revised.
		if (!COPY_MARKER.test(text.slice(match.index + token.length))) {
			continue;
		}
		if (NOT_A_MODEL.some((pattern) => pattern.test(token)) || seen.has(token)) {
			continue;
		}
		seen.add(token);
		found.push(token);
	}

	return found;
}
