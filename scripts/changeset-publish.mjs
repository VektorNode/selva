#!/usr/bin/env node

// ============================================================================
// changeset publish wrapper — tolerate already-published versions
// ============================================================================
//
// `changeset publish` exits 1 when npm rejects a re-publish of a version it
// already has, failing releases that actually succeeded. changesets has a
// native skip for this, but it only fires on npm's `--json` E403 envelope —
// and changesets shells out to `pnpm publish`, which prints plain text instead
// (hence `an error occurred while publishing X: undefined` in the logs).
// Switching to `npm publish` isn't an option: only pnpm rewrites the
// `workspace:`/`catalog:` specifiers.
//
// So: if publish fails, check the registry directly. Every publishable package
// on npm at its workspace version → the release landed, exit 0. Anything
// missing → exit non-zero. Deliberately does not parse changesets' output,
// which splits names (stdout) from the failure header (stderr).
//
// A green publish is checked too. A trusted publisher that npm has set to
// stage-only accepts the upload and exits 0, but the version never goes live
// and changesets still prints "Successfully published". Unless it's caught
// here, the release shows green and the version number ends up burned.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// SELVA_FAKE_CHANGESET_PUBLISH swaps in a stand-in for tests. Unset in CI.
const fake = process.env.SELVA_FAKE_CHANGESET_PUBLISH;
const [cmd, args] = fake
	? ['node', [fake]]
	: ['pnpm', ['exec', 'changeset', 'publish', ...process.argv.slice(2)]];

const result = spawnSync(cmd, args, {
	cwd: repoRoot,
	stdio: 'inherit',
	shell: process.platform === 'win32'
});

if (result.error) {
	console.error(`\n✗ Failed to run changeset publish: ${result.error.message}`);
	process.exit(1);
}

// Same source of truth the release workflow gates on, so the two can't
// disagree about what "everything we publish" means.
function publishablePackages() {
	// SELVA_FAKE_PACKAGE_LIST swaps in a stub list for tests. Unset in CI.
	const lister = process.env.SELVA_FAKE_PACKAGE_LIST;
	const listArgs = lister
		? [lister]
		: [join(repoRoot, 'scripts/publishable-packages.mjs'), '--list'];
	const listed = spawnSync('node', listArgs, {
		cwd: repoRoot,
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});
	if (listed.status !== 0) {
		console.error('\n✗ Could not enumerate publishable packages; cannot verify the release.');
		process.exit(result.status ?? 1);
	}
	return listed.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name, version] = line.split('\t');
			return { name, version };
		});
}

// Plain GET rather than `npm view`: spawning npm per package costs seconds each.
async function publishedVersion(name, version) {
	const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`;
	try {
		const res = await fetch(url, { headers: { accept: 'application/json' } });
		if (!res.ok) return '';
		return (await res.json())?.version ?? '';
	} catch {
		return ''; // Network failure — treat as unverified, i.e. keep the job red.
	}
}

const published = result.status === 0;

console.info(
	published
		? '\n── changeset publish succeeded; confirming the versions are live ──\n'
		: '\n── changeset publish failed; verifying the registry ──\n'
);

// A just-published version can take a moment to show up in the registry, so a
// green publish gets a few retries. A failed one is checked once.
// SELVA_VERIFY_ATTEMPTS shortens this for tests. Unset in CI.
const attempts = published ? Number(process.env.SELVA_VERIFY_ATTEMPTS ?? 6) : 1;
const RETRY_DELAY_MS = 10_000;

let pending = publishablePackages();
const live = [];

for (let attempt = 1; attempt <= attempts && pending.length > 0; attempt++) {
	if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
	const checks = await Promise.all(
		pending.map(async (pkg) => ({ ...pkg, found: await publishedVersion(pkg.name, pkg.version) }))
	);
	live.push(...checks.filter((c) => c.found === c.version));
	pending = checks.filter((c) => c.found !== c.version);
}

for (const { name, version } of live) console.info(`  ✓ ${name}@${version} — on npm.`);
for (const { name, version } of pending) console.info(`  ✗ ${name}@${version} — NOT on npm.`);
console.info('');

if (pending.length > 0) {
	console.error(
		`✗ ${pending.length} package(s) are not on npm at their workspace version:\n` +
			pending.map((p) => `  · ${p.name}@${p.version}`).join('\n') +
			'\n'
	);
	if (published) {
		console.error(
			'changeset publish exited 0, so npm most likely staged these instead of publishing them.\n' +
				"Enable direct publishing on each package's trusted publisher config on npmjs.com.\n"
		);
	}
	// exitCode, not process.exit(): exiting while fetch's keep-alive sockets
	// close trips a libuv assertion on Windows and replaces the exit code.
	process.exitCode = result.status || 1;
} else {
	console.info(
		published
			? '✓ Every publishable package is live on npm at its workspace version.\n'
			: '✓ Every publishable package is on npm at its workspace version — the release succeeded ' +
					'(changeset publish exited non-zero on redundant re-publishes). Treating as success.\n'
	);
}
