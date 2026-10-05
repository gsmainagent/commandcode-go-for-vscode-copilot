/**
 * Lifecycle for the vendored `commandcode-proxy` child process.
 *
 * ## Why a child process
 *
 * The proxy is a standalone Node program that already implements the upstream
 * protocol: the CLI-shaped request envelope, the device fingerprint, and the
 * lifecycle preflight. Re-implementing those inside the extension would mean
 * chasing a protocol that changes; running the proxy means that work is
 * maintained upstream instead. See `tools/vendor-proxy.mjs` for how the vendored
 * copy is pinned and verified.
 *
 * ## Measured behaviour this module relies on
 *
 *   - `PORT` / `HOST` environment variables select the listen address, so each
 *     instance can take an ephemeral port and two windows never collide.
 *   - `GET /health` answers `200 OK` once listening. Startup to healthy measured
 *     at 167ms, so waiting for it costs nothing perceptible.
 *   - The first generation takes ~2.5s because the fingerprint and lifecycle
 *     preflight run then; later requests take ~1.2s. The preflight is the point
 *     of the proxy, so it is not skipped.
 *   - `SIGTERM` shuts it down cleanly.
 *
 * ## Where the request envelope comes from
 *
 * The proxy builds the upstream `config` block itself, from a device profile
 * rather than the real workspace. Two reasons, both requirements rather than
 * tradeoffs: the upstream CLI always sends `config.workingDir`, while VS Code may
 * run with no folder open at all; and a real local path, branch name and commit
 * subjects are precisely the identifying detail the fingerprint exists to keep
 * out of requests. The same profile therefore serves both purposes — compatibility
 * with a field the protocol requires, and not volunteering the host's identity.
 *
 * The practical effect is that the git context an earlier build collected is no
 * longer sent upstream.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import type { CancellationToken } from 'vscode';
import { logger } from './logger';

/** How long to wait for `/health` before giving up on a child. */
const STARTUP_TIMEOUT_MS = 15_000;
/** Grace period after `SIGTERM` before escalating to `SIGKILL`. */
const SHUTDOWN_GRACE_MS = 2_000;
/** Poll interval while waiting for readiness. */
const HEALTH_POLL_MS = 100;

export interface ProxyEndpoint {
	/** Base URL to send OpenAI-shaped requests to, e.g. `http://127.0.0.1:41234/v1`. */
	readonly baseUrl: string;
	readonly port: number;
}

export interface StartProxyOptions {
	/** Absolute path to the extension root, used to locate the vendored copy. */
	readonly extensionPath: string;
	readonly token?: CancellationToken;
}

/**
 * Ask the OS for a free port.
 *
 * The socket is closed before the proxy binds it, so there is a small race in
 * principle. In practice the window is microseconds and the alternative — a
 * fixed port — fails deterministically when a developer already runs the proxy.
 */
function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			probe.close(() => {
				if (port > 0) {
					resolve(port);
				} else {
					reject(new Error('could not determine a free port'));
				}
			});
		});
	});
}

function waitForHealth(port: number, deadline: number): Promise<boolean> {
	return new Promise((resolve) => {
		const attempt = async (): Promise<void> => {
			if (Date.now() >= deadline) {
				resolve(false);
				return;
			}
			try {
				const response = await fetch(`http://127.0.0.1:${port}/health`, {
					signal: AbortSignal.timeout(1_000),
				});
				if (response.ok) {
					resolve(true);
					return;
				}
			} catch {
				// Not listening yet.
			}
			setTimeout(() => void attempt(), HEALTH_POLL_MS);
		};
		void attempt();
	});
}

/**
 * A running proxy, or the reason it is not running.
 *
 * `unavailable` is the normal state before the first chat request: the proxy is
 * started lazily so that installing the extension does not immediately spawn a
 * process that may never be used.
 */
export interface ProxyState {
	readonly status: 'stopped' | 'starting' | 'ready' | 'unavailable';
	readonly endpoint?: ProxyEndpoint;
	readonly error?: string;
}

let child: ChildProcess | undefined;
let starting: Promise<ProxyState> | undefined;
let state: ProxyState = { status: 'stopped' };

/** Exposed for tests and for the status command. */
export function getProxyState(): ProxyState {
	return state;
}

/**
 * Start the proxy if it is not already running, and return its endpoint.
 *
 * Safe to call on every request: the first call starts the process, later calls
 * await the same promise. A failed start is not cached, so a transient failure
 * (for example the port being taken between probe and bind) can be retried on
 * the next request rather than disabling the extension until reload.
 */
export async function ensureProxy(options: StartProxyOptions): Promise<ProxyState> {
	if (state.status === 'ready' && state.endpoint) {
		return state;
	}
	if (starting) {
		return starting;
	}

	state = { status: 'starting' };
	starting = startProxy(options)
		.then((result) => {
			state = result;
			return result;
		})
		.finally(() => {
			starting = undefined;
		});
	return starting;
}

async function startProxy(options: StartProxyOptions): Promise<ProxyState> {
	const entrypoint = join(options.extensionPath, 'vendor', 'commandcode-proxy', 'proxy.mjs');

	let port: number;
	try {
		port = await findFreePort();
	} catch (error) {
		const message = `could not allocate a port for the proxy: ${String(error)}`;
		logger.error(message);
		return { status: 'unavailable', error: message };
	}

	logger.info(`Starting commandcode-proxy on 127.0.0.1:${port}`);

	const proc = spawn(process.execPath, [entrypoint], {
		env: {
			...process.env,
			PORT: String(port),
			HOST: '127.0.0.1',
			// The Provider API is unavailable on the Go plan, so the proxy must not
			// try to read models from it. This extension resolves ids itself.
			CC_USE_PROVIDER_MODELS: 'false',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		// Own process group: if the extension host is killed, the proxy goes with
		// it instead of lingering as an orphan holding a port.
		detached: false,
	});

	child = proc;

	let exitReason: string | undefined;
	proc.on('exit', (code, signal) => {
		exitReason = `exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`;
		// Only reset if this child is still the current one; a restart may have
		// replaced it already.
		if (child === proc) {
			child = undefined;
			state = { status: 'unavailable', error: `the proxy ${exitReason}` };
		}
	});
	proc.on('error', (error) => {
		exitReason = `failed to start: ${error.message}`;
	});

	// The proxy logs one JSON object per line. Surface warnings rather than
	// discarding them: `CC CLI version drift` is how a vendored copy announces
	// that its protocol implementation has fallen behind the upstream CLI.
	const tap = (chunk: Buffer): void => {
		for (const line of chunk.toString('utf8').split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			if (/\[warn\]/.test(trimmed)) {
				logger.warn(`proxy: ${trimmed.slice(0, 300)}`);
			} else if (/CLI version drift/.test(trimmed)) {
				logger.warn(
					`proxy: ${trimmed.slice(0, 300)}. The vendored copy needs a newer commit; ` +
						'see tools/vendor-proxy.mjs.',
				);
			}
		}
	};
	proc.stdout?.on('data', tap);
	proc.stderr?.on('data', tap);

	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	const healthy = await waitForHealth(port, deadline);

	if (options.token?.isCancellationRequested) {
		stopProxy();
		return { status: 'unavailable', error: 'cancelled while starting' };
	}

	if (!healthy) {
		const reason = exitReason ?? `did not become healthy within ${STARTUP_TIMEOUT_MS}ms`;
		logger.error(`commandcode-proxy ${reason}`);
		stopProxy();
		return { status: 'unavailable', error: reason };
	}

	const endpoint: ProxyEndpoint = { baseUrl: `http://127.0.0.1:${port}/v1`, port };
	logger.info(`commandcode-proxy ready on port ${port}`);
	return { status: 'ready', endpoint };
}

/**
 * Stop the proxy, escalating if it ignores `SIGTERM`.
 *
 * Called from deactivate and before a restart, so a reload does not leave
 * processes behind holding ports.
 */
export function stopProxy(): void {
	const proc = child;
	if (!proc) {
		state = { status: 'stopped' };
		return;
	}
	child = undefined;

	if (proc.exitCode !== null || proc.signalCode !== null) {
		state = { status: 'stopped' };
		return;
	}

	proc.once('exit', () => {
		state = { status: 'stopped' };
	});
	try {
		proc.kill('SIGTERM');
	} catch (error) {
		logger.warn('Failed to signal the proxy', error);
		return;
	}

	setTimeout(() => {
		if (proc.exitCode === null && proc.signalCode === null) {
			logger.warn('Proxy ignored SIGTERM; sending SIGKILL');
			try {
				proc.kill('SIGKILL');
			} catch {
				// Already gone.
			}
		}
	}, SHUTDOWN_GRACE_MS).unref?.();
}

/** Reset all state. Used by tests. */
export function resetProxyForTests(): void {
	stopProxy();
	starting = undefined;
	state = { status: 'stopped' };
}
