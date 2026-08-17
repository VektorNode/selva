#!/usr/bin/env node

// ============================================================================
// Unconsumed changesets in pre mode
// ============================================================================
//
// Prints the name of every changeset on this ref that `changeset version` has
// NOT yet folded into a prerelease, one per line. Exit status is always 0 —
// callers count the lines.
//
//   node scripts/unconsumed-changesets.mjs
//
// In pre mode `changeset version` does not delete a consumed .md; it moves it
// to `.changeset/pre/`. So "unconsumed" = still sitting in `.changeset/` root.
//
// Changesets 2.x instead left every .md in the root and tracked the consumed
// ids in `pre.json.changesets`. That array does not exist in 3.x — reading it
// throws `Cannot read properties of undefined`, which fails the beta release at
// the leftover gate rather than at anything real. Both layouts are handled so
// this keeps working across the upgrade and on any 2.x branch not yet rebased.
//
// Dependency-free on purpose: the release workflow runs this on the runner's
// system node BEFORE `pnpm install`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const changesetDir = join(repoRoot, '.changeset');

function changesetNamesIn(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'README.md')
		.map((d) => d.name.slice(0, -'.md'.length));
}

const inRoot = changesetNamesIn(changesetDir);

// 2.x fallback: consumed ids listed in pre.json rather than moved out of root.
const preJsonPath = join(changesetDir, 'pre.json');
let consumed = new Set();
if (existsSync(preJsonPath)) {
	const pre = JSON.parse(readFileSync(preJsonPath, 'utf8'));
	if (Array.isArray(pre.changesets)) consumed = new Set(pre.changesets);
}

for (const name of inRoot) {
	if (!consumed.has(name)) console.info(name);
}
