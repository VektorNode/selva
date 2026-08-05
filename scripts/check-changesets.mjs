#!/usr/bin/env node

// ============================================================================
// PR changeset guard
// ============================================================================
//
// Releases are driven entirely by changesets: a change to a publishable
// package without one never ships, and its CHANGELOG never mentions it. This
// check fails a PR that modifies a publishable package's shipped surface
// without naming that package in a changeset.
//
//   node scripts/check-changesets.mjs --base <ref>
//
// <ref> is the base to diff against (CI passes the PR base; the checkout is
// the PR merge ref, so a plain two-ref diff is exactly the PR's delta and
// needs no merge-base — shallow clones are fine).
//
// Escape hatch: an empty changeset (`pnpm changeset --empty`) in the PR
// declares "intentionally no release" and passes everything.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkspacePackages } from './publishable-packages.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const baseIndex = process.argv.indexOf('--base');
const baseRef = baseIndex !== -1 ? process.argv[baseIndex + 1] : null;
const headIndex = process.argv.indexOf('--head');
const headRef = headIndex !== -1 ? process.argv[headIndex + 1] : 'HEAD';
if (!baseRef) {
	console.error('Usage: check-changesets.mjs --base <ref> [--head <ref>]');
	process.exit(1);
}

const changedFiles = execFileSync('git', ['diff', '--name-only', baseRef, headRef], {
	cwd: repoRoot,
	encoding: 'utf8'
})
	.split('\n')
	.filter(Boolean);

// Files that don't ship: tests, docs, and local tooling config. Everything
// else in a package dir counts — conservative on purpose, with the empty
// changeset as the explicit escape hatch.
function shipsToConsumers(pathInPackage) {
	return !(
		/(^|\/)__tests__\//.test(pathInPackage) ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(pathInPackage) ||
		pathInPackage.endsWith('.md') ||
		/(^|\/)(vitest|playwright)\.config\./.test(pathInPackage) ||
		/(^|\/)e2e\//.test(pathInPackage)
	);
}

const publishable = readWorkspacePackages().filter((p) => !p.private);
// Longest prefix wins, so nested package dirs never misattribute.
const byPrefixDesc = [...publishable].sort((a, b) => b.relDir.length - a.relDir.length);

const touched = new Map(); // package name -> changed shipped files
for (const file of changedFiles) {
	const pkg = byPrefixDesc.find((p) => file.startsWith(p.relDir + '/'));
	if (!pkg) continue;
	const inPackage = file.slice(pkg.relDir.length + 1);
	if (!shipsToConsumers(inPackage)) continue;
	if (!touched.has(pkg.name)) touched.set(pkg.name, []);
	touched.get(pkg.name).push(file);
}

// Which packages do the PR's changesets cover?
const covered = new Set();
let hasEmptyChangeset = false;
for (const file of changedFiles) {
	if (!/^\.changeset\/[^/]+\.md$/.test(file) || file.endsWith('README.md')) continue;
	let content;
	try {
		content = execFileSync('git', ['show', `${headRef}:${file}`], {
			cwd: repoRoot,
			encoding: 'utf8'
		});
	} catch {
		continue; // deleted in this PR (e.g. consumed by a version commit)
	}
	const frontmatter = content.match(/^---\n([\s\S]*?)\n?---/);
	if (!frontmatter) continue;
	const entries = [...frontmatter[1].matchAll(/^\s*['"]?(@?[\w./-]+)['"]?\s*:/gm)];
	if (entries.length === 0) hasEmptyChangeset = true;
	for (const e of entries) covered.add(e[1]);
}

const missing = [...touched.entries()].filter(([name]) => !covered.has(name));

if (missing.length === 0 || hasEmptyChangeset) {
	if (missing.length > 0) {
		console.info(
			`✓ ${missing.length} package(s) changed without a changeset, waived by an empty changeset`
		);
	} else {
		console.info(`✓ changeset check passed (${touched.size} publishable package(s) changed)`);
	}
	process.exit(0);
}

console.error('✗ Publishable packages changed without a changeset:\n');
for (const [name, files] of missing) {
	console.error(`  ${name}`);
	for (const f of files.slice(0, 5)) console.error(`    ${f}`);
	if (files.length > 5) console.error(`    … and ${files.length - 5} more`);
}
console.error('');
console.error('  Add one with `pnpm changeset` — without it this change never releases.');
console.error('  For changes that genuinely need no release: `pnpm changeset --empty`.');
process.exit(1);
