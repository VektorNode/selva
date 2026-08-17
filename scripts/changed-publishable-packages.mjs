#!/usr/bin/env node

// ============================================================================
// Publishable packages touched by a diff
// ============================================================================
//
// Prints one package name per line — the exact set `check-changesets.mjs`
// demands a changeset for.
//
//   node scripts/changed-publishable-packages.mjs --base <ref> [--head <ref>]
//
// Used by the Dependabot auto-merge workflow to author a changeset on the bot's
// behalf. Detection is imported from the guard rather than reimplemented: if
// the two ever disagreed, the workflow would write a changeset naming a
// different set than the guard requires and every Dependabot PR would deadlock.

import { diffFiles, touchedPublishablePackages } from './check-changesets.mjs';

const baseIndex = process.argv.indexOf('--base');
const baseRef = baseIndex !== -1 ? process.argv[baseIndex + 1] : null;
const headIndex = process.argv.indexOf('--head');
const headRef = headIndex !== -1 ? process.argv[headIndex + 1] : 'HEAD';
if (!baseRef) {
	console.error('Usage: changed-publishable-packages.mjs --base <ref> [--head <ref>]');
	process.exit(1);
}

for (const name of touchedPublishablePackages(diffFiles(baseRef, headRef)).keys()) {
	console.info(name);
}
