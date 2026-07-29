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

if (result.status === 0) process.exit(0);

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

console.info('\n── changeset publish failed; verifying the registry ──\n');

const packages = publishablePackages();
const checks = await Promise.all(
	packages.map(async (pkg) => ({ ...pkg, found: await publishedVersion(pkg.name, pkg.version) }))
);

const missing = [];

for (const { name, version, found } of checks) {
	if (found === version) {
		console.info(`  ✓ ${name}@${version} — on npm.`);
	} else {
		console.info(`  ✗ ${name}@${version} — NOT on npm.`);
		missing.push(`${name}@${version}`);
	}
}

console.info('');

if (missing.length > 0) {
	console.error(
		`✗ ${missing.length} package(s) are not on npm at their workspace version:\n` +
			missing.map((p) => `  · ${p}`).join('\n') +
			'\n'
	);
	process.exit(result.status ?? 1);
}

console.info(
	'✓ Every publishable package is on npm at its workspace version — the release succeeded ' +
		'(changeset publish exited non-zero on redundant re-publishes). Treating as success.\n'
);
process.exit(0);
