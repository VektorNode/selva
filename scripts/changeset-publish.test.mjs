#!/usr/bin/env node

// ============================================================================
// Regression tests for scripts/changeset-publish.mjs
// ============================================================================
//
// Run with: node scripts/changeset-publish.test.mjs
//
// There is no root vitest project (the root `test` script fans out to workspace
// packages via turbo), so this is a self-contained runner rather than a suite.
//
// The case that matters most is ANSI. changesets colorizes its output, so in CI
// the failure block arrives as `🦋  \x1b[31merror\x1b[39m @selvajs/cli@4.7.1`.
// A parser that only strips the plain `🦋  error ` prefix sees no parseable
// entries, reports "no failure list found", and turns a redundant re-publish
// into a red release — which is exactly what happened on 2026-07-29
// (run 30467367005) after the whole point of this wrapper was to prevent it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = join(here, 'changeset-publish.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'changeset-publish-test-'));

// A version that will never exist on npm, so the "genuine failure" cases below
// test the unforgiving path without depending on registry state.
const ABSENT = '@selvajs/cli@99.99.99';
// Published long before this test was written; used for the forgiving path.
const PRESENT = '@selvajs/cli@4.7.1';

/** Build a fake `changeset publish` that emits `lines` and exits non-zero. */
function fakePublisher(name, lines) {
	const path = join(workDir, `${name}.mjs`);
	writeFileSync(
		path,
		`process.stdout.write(${JSON.stringify(lines.join('\n') + '\n')});\nprocess.exit(1);\n`
	);
	return path;
}

function runWrapper(fakePath) {
	return spawnSync('node', [wrapper], {
		encoding: 'utf8',
		env: { ...process.env, SELVA_FAKE_CHANGESET_PUBLISH: fakePath }
	});
}

const E = '';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── the regression ──────────────────────────────────────────────────────────

test('forgives an already-published version when output is ANSI-colored', () => {
	const fake = fakePublisher('ansi-published', [
		`🦋  ${E}[31merror${E}[39m an error occurred while publishing @selvajs/cli: undefined You cannot publish over the previously published versions: 4.7.1. `,
		`🦋  ${E}[31merror${E}[39m packages failed to publish:`,
		`🦋  ${E}[31merror${E}[39m ${PRESENT}`
	]);
	const r = runWrapper(fake);
	assert(r.status === 0, `expected exit 0, got ${r.status}\n${r.stdout}${r.stderr}`);
	assert(
		!r.stderr.includes('no "packages failed to publish" list was found'),
		'ANSI output must not be mistaken for a missing failure list'
	);
});

test('forgives an already-published version when output is plain', () => {
	const fake = fakePublisher('plain-published', [
		'🦋  error packages failed to publish:',
		`🦋  ${PRESENT}`
	]);
	const r = runWrapper(fake);
	assert(r.status === 0, `expected exit 0, got ${r.status}\n${r.stdout}${r.stderr}`);
});

// ── the guardrails: forgiveness must stay narrow ─────────────────────────────

test('fails when a reported package is genuinely absent from the registry', () => {
	const fake = fakePublisher('ansi-absent', [
		`🦋  ${E}[31merror${E}[39m packages failed to publish:`,
		`🦋  ${E}[31merror${E}[39m ${ABSENT}`
	]);
	const r = runWrapper(fake);
	assert(r.status !== 0, 'a version npm does not serve must keep the release red');
	assert(
		r.stderr.includes('genuinely failed to publish'),
		`expected the genuine-failure message, got:\n${r.stderr}`
	);
});

test('fails when one of several packages is absent', () => {
	const fake = fakePublisher('ansi-mixed', [
		`🦋  ${E}[31merror${E}[39m packages failed to publish:`,
		`🦋  ${E}[31merror${E}[39m ${PRESENT}`,
		`🦋  ${E}[31merror${E}[39m ${ABSENT}`
	]);
	const r = runWrapper(fake);
	assert(r.status !== 0, 'one absent package must fail the whole run');
});

test('fails when there is no failure block at all (build/auth crash)', () => {
	const fake = fakePublisher('no-block', ['🦋  error something else went wrong entirely']);
	const r = runWrapper(fake);
	assert(r.status !== 0, 'a non-publish failure must not be forgiven');
	assert(
		r.stderr.includes('no "packages failed to publish" list was found'),
		`expected the missing-list message, got:\n${r.stderr}`
	);
});

// ============================================================================
// Runner
// ============================================================================

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

let failures = 0;
for (const { name, fn } of tests) {
	try {
		fn();
		console.info(`  ✓ ${name}`);
	} catch (err) {
		failures++;
		console.error(`  ✗ ${name}\n    ${err.message}`);
	}
}

console.info('');
if (failures > 0) {
	console.error(`${failures} of ${tests.length} test(s) failed.\n`);
	process.exit(1);
}
console.info(`All ${tests.length} tests passed.\n`);
