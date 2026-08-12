#!/usr/bin/env node

// ============================================================================
// Changeset content validator
// ============================================================================
//
// Rejects changesets that `changeset version` will reject, but does it before
// the release job spends five minutes on type-check and tests. Two rules, both
// of which changesets enforces itself and neither of which any other check
// catches:
//
//   (1) Mixed changeset — one changeset naming both an `ignore`d package and a
//       publishable one. Changesets refuses to version it at all.
//   (2) Unknown package — a name that isn't in the workspace, usually a typo or
//       a rename that missed the changeset.
//
// A pre-commit hook runs `changeset status` for the same reasons, but that hook
// is local: --no-verify, a GUI client, or any push that didn't come from a
// developer machine reaches CI unchecked.
//
// Dependency-free, like publishable-packages.mjs — the release workflow runs
// this on the runner's system node BEFORE `pnpm install`, so `changeset status`
// itself isn't available yet.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkspacePackages } from './publishable-packages.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const changesetDir = join(repoRoot, '.changeset');

function readChangesetFiles() {
	if (!existsSync(changesetDir)) return [];
	return readdirSync(changesetDir, { withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'README.md')
		.map((d) => d.name);
}

// Frontmatter entries are `'@scope/name': patch`. Quotes are optional and
// changesets writes them for scoped names, so accept both.
function readNamedPackages(file) {
	const content = readFileSync(join(changesetDir, file), 'utf8');
	const frontmatter = content.match(/^---\n([\s\S]*?)\n?---/);
	if (!frontmatter) return [];
	return [...frontmatter[1].matchAll(/^\s*['"]?(@?[\w./-]+)['"]?\s*:/gm)].map((m) => m[1]);
}

const config = JSON.parse(readFileSync(join(changesetDir, 'config.json'), 'utf8'));
const ignored = new Set(Array.isArray(config.ignore) ? config.ignore : []);
const known = new Set(readWorkspacePackages().map((p) => p.name));

const violations = [];

for (const file of readChangesetFiles()) {
	const named = readNamedPackages(file);
	if (named.length === 0) continue; // `changeset --empty` — legitimately names nothing

	const unknown = named.filter((n) => !known.has(n));
	if (unknown.length > 0) {
		violations.push(
			`.changeset/${file} names package(s) not in the workspace: ${unknown.join(', ')}`
		);
	}

	const ignoredHere = named.filter((n) => ignored.has(n));
	const publishableHere = named.filter((n) => known.has(n) && !ignored.has(n));
	if (ignoredHere.length > 0 && publishableHere.length > 0) {
		violations.push(
			`.changeset/${file} mixes ignored and publishable packages — changesets refuses to version it.\n` +
				`      ignored:     ${ignoredHere.join(', ')}\n` +
				`      publishable: ${publishableHere.join(', ')}\n` +
				`      Split it into one changeset per group.`
		);
	}
}

if (violations.length > 0) {
	console.error('✗ changeset validation failed:\n');
	for (const v of violations) console.error('  · ' + v);
	console.error('');
	process.exit(1);
}

console.info('✓ changesets are valid');
