#!/usr/bin/env node

// ============================================================================
// Test data, examples and dev scenes: location, naming and inventory
// ============================================================================
//
// Enforces "Test data, examples and dev scenes" in STRUCTURE.md:
//
// - A `fixtures/` folder only exists at an allowed test scope.
// - Files in fixtures, examples and dev folders are kebab-case.
// - Every file under dev/ and examples/ is listed in that folder's README.md.
//
// Reads what git tracks plus untracked files that aren't ignored, so a file
// added but not yet committed is checked too.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FIXTURE_SCOPES = [
	/(^|\/)__tests__\/fixtures\//,
	/^packages\/[^/]+\/tests\/fixtures\//,
	/^packages\/schemas\/fixtures\//,
	/^packages\/selva\/e2e\/fixtures\//
];

// Folders whose files follow the naming rule.
const NAMED_SCOPES = [
	/(^|\/)fixtures\//,
	/^dev\//,
	/^examples\//,
	/^packages\/[^/]+\/examples\/data\//,
	/^packages\/[^/]+\/dev\//
];

// Folders whose README.md must list every file inside them.
const INVENTORIES = ['dev', 'examples'];

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)+$/;
const EXEMPT_NAMES = new Set(['README.md']);

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
	cwd: repoRoot,
	encoding: 'utf8'
})
	.split('\n')
	.filter(Boolean)
	.map((path) => path.replaceAll('\\', '/'))
	// Deleted but not yet staged: git still lists it.
	.filter((path) => existsSync(join(repoRoot, path)));

const problems = [];

for (const path of files) {
	// `__tests__/fixtures.ts` is a helper module, not a folder.
	if (/(^|\/)fixtures\//.test(path) && !FIXTURE_SCOPES.some((scope) => scope.test(path))) {
		problems.push(`${path}: fixtures/ is for test data at a test scope only`);
	}

	const name = basename(path);
	if (
		NAMED_SCOPES.some((scope) => scope.test(path)) &&
		!EXEMPT_NAMES.has(name) &&
		!KEBAB.test(name)
	) {
		problems.push(`${path}: name must be kebab-case`);
	}
}

for (const folder of INVENTORIES) {
	let manifest;
	try {
		manifest = readFileSync(join(repoRoot, folder, 'README.md'), 'utf8');
	} catch {
		problems.push(`${folder}/README.md: missing; it lists every file in ${folder}/`);
		continue;
	}
	for (const path of files) {
		if (!path.startsWith(`${folder}/`) || basename(path) === 'README.md') continue;
		if (!manifest.includes(basename(path))) {
			problems.push(`${path}: not listed in ${folder}/README.md`);
		}
	}
}

if (problems.length > 0) {
	console.error(
		`✗ ${problems.length} fixture rule violation(s) (STRUCTURE.md, "Test data, examples and dev scenes"):`
	);
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}
console.log('✓ Fixtures, examples and dev scenes follow the rules');
