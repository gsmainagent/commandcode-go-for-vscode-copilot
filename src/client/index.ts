/**
 * Error presentation for Command Code requests.
 *
 * The upstream protocol now lives in the vendored `commandcode-proxy`, so the
 * transport in `proxy-client.ts` no longer reimplements SSE parsing or the
 * CLI-shaped envelope. What remains here is the part worth keeping regardless of
 * transport: turning network and HTTP failures into something a user can act on,
 * with the Command Code docs links attached.
 */
export {
	createHttpError,
	createUserFacingError,
	CommandCodeRequestError,
	formatRequestError,
	normalizeRequestError,
	setErrorActionUrl,
} from './error';
export type { CommandCodeRequestErrorKind, ErrorActionUrls } from './types';
