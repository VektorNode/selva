#!/usr/bin/env node

// ============================================================================
// changeset publish wrapper — tolerate already-published versions
// ============================================================================
//
// Why this exists
// ---------------
// `changeset publish` decides what to publish by asking the registry (`npm
// info <pkg>`) which versions exist. That read can be STALE — npm's read path
// is a cache, its write path is consistent. When the read lags, changesets
// concludes "not published yet", calls `npm publish`, and npm correctly
// rejects with:
//
//   You cannot publish over the previously published versions: X.Y.Z.
//
// The package is already on npm at exactly the version we wanted. Nothing is
// wrong. But `changeset publish` exits 1, which fails the release job and
// makes a no-op look like a broken release. (Observed 2026-07-29: 3 packages
// published, 6 rejected this way, workflow red despite npm holding all 9 at
// the intended versions.)
//
// What this does
// --------------
// Runs `changeset publish`, then reconciles its failures against reality:
// every package changesets FAILED to publish is checked against the registry.
// The failure is forgiven ONLY IF npm now serves that package at exactly the
// version in our workspace — i.e. the intended release is on npm and the error
// was a redundant re-publish.
//
// Anything else — a 403, an OIDC/auth failure, a network error, a version
// mismatch, a package still absent from npm — keeps the non-zero exit. This
// deliberately does NOT parse the error text to decide forgiveness: it asks
// the registry for ground truth, so a future npm error-message change can't
// silently widen what gets swallowed.
//
// Consequence to keep in mind: this makes the release job green when the
// registry already holds the intended versions. It does not make a FAILED
// release green.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================================
// Run changeset publish
// ============================================================================

// Output is piped rather than inherited because we need to parse the failure
// list out of it; it's re-emitted verbatim below, so CI logs still show
// everything changesets printed — just buffered until the command exits
// instead of streaming live.
//
// SELVA_FAKE_CHANGESET_PUBLISH swaps in a stand-in command for tests, so the
// reconciliation logic can be exercised without publishing to npm. Unset in CI.
const fake = process.env.SELVA_FAKE_CHANGESET_PUBLISH;
const [cmd, args] = fake
	? ['node', [fake]]
	: ['pnpm', ['exec', 'changeset', 'publish', ...process.argv.slice(2)]];

const result = spawnSync(cmd, args, {
	cwd: repoRoot,
	encoding: 'utf8',
	shell: process.platform === 'win32'
});

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.error) {
	console.error(`\n✗ Failed to run changeset publish: ${result.error.message}`);
	process.exit(1);
}

if (result.status === 0) process.exit(0);

// ============================================================================
// Parse the failure list
// ============================================================================
//
// changesets prints a trailing block:
//
//   🦋  error packages failed to publish:
//   🦋  @selvajs/compute@3.1.0
//   🦋  @selvajs/platform@0.15.0
//
// Take names from that block only. If the block is absent the run failed for
// some other reason (build error, auth, crash) — no reconciliation, just fail.

function parseFailedPackages(output) {
	const lines = output.split('\n');
	const start = lines.findIndex((l) => l.includes('packages failed to publish:'));
	if (start === -1) return null;

	const failed = [];
	for (const line of lines.slice(start + 1)) {
		// Strip the changesets prefix ("🦋  " / "🦋  error ") and whitespace.
		const stripped = line.replace(/^\s*🦋\s*(error\s*)?/u, '').trim();
		if (!stripped) continue;
		// `@scope/name@1.2.3` — scoped names have a leading @, so match the LAST @.
		const at = stripped.lastIndexOf('@');
		if (at <= 0) break; // Left the block.
		const name = stripped.slice(0, at);
		const version = stripped.slice(at + 1);
		if (!/^\d+\.\d+\.\d+/.test(version)) break; // Left the block.
		failed.push({ name, version });
	}
	return failed.length > 0 ? failed : null;
}

const failed = parseFailedPackages(stdout + '\n' + stderr);

if (!failed) {
	console.error(
		'\n✗ changeset publish failed and no "packages failed to publish" list was found — not an already-published case. Failing.'
	);
	process.exit(result.status ?? 1);
}

// ============================================================================
// Reconcile each failure against the registry
// ============================================================================

console.info('\n── Reconciling failed publishes against the registry ──\n');

const unresolved = [];

for (const { name, version } of failed) {
	const view = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});
	const published = (view.stdout ?? '').trim();

	if (view.status === 0 && published === version) {
		console.info(`  ✓ ${name}@${version} — already on npm at the intended version; forgiving.`);
	} else {
		console.info(
			`  ✗ ${name}@${version} — registry does not serve this version (got ${published || '<none>'}).`
		);
		unresolved.push(`${name}@${version}`);
	}
}

console.info('');

if (unresolved.length > 0) {
	console.error(
		`✗ ${unresolved.length} package(s) genuinely failed to publish:\n` +
			unresolved.map((p) => `  · ${p}`).join('\n') +
			'\n'
	);
	process.exit(result.status ?? 1);
}

console.info(
	`✓ All ${failed.length} reported failure(s) were redundant re-publishes — the registry already holds the intended versions. Treating the release as successful.\n`
);
process.exit(0);
