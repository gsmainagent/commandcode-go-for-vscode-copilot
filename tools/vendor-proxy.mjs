#!/usr/bin/env node
/**
 * Vendor `commandcode-proxy` at a pinned git commit, with content verification.
 *
 * ## Why git and not npm
 *
 * The npm package `commandcode-proxy@1.0.0` is a different, earlier lineage, not
 * a release of this repository. It targets CLI `0.26.3`, reads the API key from
 * `~/.commandcode/auth.json` (so it requires a local Command Code CLI install),
 * and carries none of the risk-control code: no device fingerprint, no
 * lifecycle preflight, no `x-project-slug`. The repository's own `v1.0.0` tag
 * is three months newer than the npm artifact of the same name, and the current
 * `main` is newer still.
 *
 * The risk control is the entire reason this is vendored, so the pin has to name
 * a commit that contains it.
 *
 * ## What is verified
 *
 * The entrypoint's SHA-256, recorded here in the manifest. `--check` re-verifies
 * the on-disk copy from that digest without touching the network, so a modified
 * vendored file fails the build. The digest matters because this file sits on
 * the path that carries the API key and is spawned as a child process.
 *
 * Run: node tools/vendor-proxy.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(ROOT, 'vendor', 'commandcode-proxy');
const TARGET = join(VENDOR_DIR, 'proxy.mjs');
const MANIFEST = join(VENDOR_DIR, 'VENDOR.json');
const STAGING = join(ROOT, 'vendor', '.staging');

const REPO = 'https://github.com/MAXeaglet/commandcode-proxy.git';

/**
 * Pinned commit. This is the tree the integration was verified against:
 * startup to /health in 167ms, tool calls and reasoning intact through the
 * OpenAI-shaped hop, clean SIGTERM shutdown.
 */
const COMMIT = 'ce5a2177d177893760300b2ae734989a0d56acbb';

/**
 * Recorded at vendor time and re-checked by `--check`. Keeping it in the
 * manifest rather than re-deriving it means a modified file is caught offline.
 */
const PROXY_MJS_SHA256 = '809efb2399ceada06abd47de5e72e7b6e42d83981bd61a483c6b7d55e8ef70cd';

const checkOnly = process.argv.includes('--check');

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function readManifest() {
	if (!existsSync(MANIFEST)) {
		throw new Error(`missing ${MANIFEST}; run without --check to vendor`);
	}
	return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

if (checkOnly) {
	const manifest = readManifest();
	if (manifest.commit !== COMMIT) {
		throw new Error(`vendored commit ${manifest.commit} != pinned ${COMMIT}`);
	}
	if (!existsSync(TARGET)) {
		throw new Error(`missing ${TARGET}`);
	}
	const actual = sha256File(TARGET);
	if (actual !== manifest.fileSha256) {
		throw new Error(
			`vendored ${TARGET} has been modified\n` +
				`  expected sha256 ${manifest.fileSha256}\n` +
				`  actual   sha256 ${actual}`,
		);
	}
	// MIT requires the licence to travel with the code.
	for (const file of ['LICENSE', 'package.json']) {
		if (!existsSync(join(VENDOR_DIR, file))) {
			throw new Error(`missing vendored ${file}`);
		}
	}
	console.log(
		`commandcode-proxy @${manifest.commit.slice(0, 12)} verified: ` +
			`proxy.mjs sha256 ${actual.slice(0, 16)}…, licence present`,
	);
	process.exit(0);
}

console.log(`vendoring commandcode-proxy @ ${COMMIT.slice(0, 12)}…`);

// Staged inside the repo rather than /tmp: /tmp is a tmpfs here, so moving a
// file out of it is a cross-device copy and rename(2) fails with EXDEV.
rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });

execFileSync('git', ['init', '--quiet', STAGING], { stdio: 'inherit' });
execFileSync('git', ['-C', STAGING, 'remote', 'add', 'origin', REPO], { stdio: 'inherit' });
// Fetch the one commit, so the vendored tree is exactly it and cannot drift.
execFileSync('git', ['-C', STAGING, 'fetch', '--quiet', '--depth', '1', 'origin', COMMIT], {
	stdio: 'inherit',
});

// Confirm what git actually handed us is the commit we asked for.
const head = execFileSync('git', ['-C', STAGING, 'rev-parse', 'FETCH_HEAD'], {
	encoding: 'utf8',
}).trim();
if (head !== COMMIT) {
	throw new Error(`fetched ${head}, expected ${COMMIT}`);
}

mkdirSync(VENDOR_DIR, { recursive: true });

for (const file of ['proxy.mjs', 'LICENSE', 'package.json']) {
	// `git show` writes to stdout, so the content is captured and then written.
	// This keeps the file byte-exact instead of routing it through a shell.
	const content = execFileSync('git', ['-C', STAGING, 'show', `${COMMIT}:${file}`], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	writeFileSync(join(VENDOR_DIR, file), content);
}

const digest = sha256File(TARGET);
if (PROXY_MJS_SHA256 && PROXY_MJS_SHA256 !== digest) {
	throw new Error(
		`proxy.mjs digest changed for pinned commit ${COMMIT}\n` +
			`  pinned in tools/vendor-proxy.mjs ${PROXY_MJS_SHA256}\n` +
			`  fetched                  ${digest}\n` +
			'A git commit cannot change content, so this means the fetch was tampered with or ' +
			'the pin is wrong. Review before relaxing the check.',
	);
}

const licence = readFileSync(join(VENDOR_DIR, 'LICENSE'), 'utf8');
writeFileSync(
	join(VENDOR_DIR, 'LICENSE'),
	`Vendored from commandcode-proxy @${COMMIT} (MIT).\n` +
		`Upstream: ${REPO}\n` +
		`Vendored unmodified. Refresh with tools/vendor-proxy.mjs after bumping COMMIT.\n\n` +
		licence,
);

writeFileSync(
	MANIFEST,
	`${JSON.stringify(
		{
			repo: REPO,
			commit: COMMIT,
			commitDate: execFileSync('git', ['-C', STAGING, 'show', '-s', '--format=%cI', COMMIT], {
				encoding: 'utf8',
			}).trim(),
			fileSha256: digest,
			entrypoint: 'proxy.mjs',
			// The proxy logs this when its protocol implementation trails the
			// upstream CLI. Surfaced in the extension log, because a vendored copy
			// cannot be updated by anyone but us.
			note: 'Bump COMMIT when the upstream proxy re-aligns with the CLI protocol. ' +
				'Do not vendor from npm: that package is an earlier lineage without risk control.',
		},
		null,
		2,
	)}\n`,
);

rmSync(STAGING, { recursive: true, force: true });

console.log(`vendored -> ${TARGET}`);
console.log(`  commit  ${COMMIT}`);
console.log(`  sha256  ${digest}`);