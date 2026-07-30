#!/usr/bin/env node

// Tests for scripts/changeset-publish.mjs — run: node scripts/changeset-publish.test.mjs
//
// Hits the real registry (the point is agreeing with npm), so needs network.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = join(here, 'changeset-publish.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'changeset-publish-test-'));

/** A stand-in `changeset publish` that exits with `code`. */
function fakePublisher(name, code, output = '') {
	const path = join(workDir, `${name}.mjs`);
	writeFileSync(path, `process.stdout.write(${JSON.stringify(output)});\nprocess.exit(${code});\n`);
	return path;
}

function runWrapper(fakePath) {
	return spawnSync('node', [wrapper], {
		encoding: 'utf8',
		env: { ...process.env, SELVA_FAKE_CHANGESET_PUBLISH: fakePath }
	});
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('passes through a successful publish without touching the registry', () => {
	const r = runWrapper(fakePublisher('ok', 0));
	assert(r.status === 0, `expected exit 0, got ${r.status}`);
	assert(
		!r.stdout.includes('verifying the registry'),
		'a green publish must not trigger reconciliation'
	);
});

test('forgives a failed publish when every version is already on npm', () => {
	// The real 2026-07-29 shape: pnpm prints plain text, changesets misreads it
	// as a failure, but all workspace versions are in fact published.
	const r = runWrapper(
		fakePublisher(
			'already-published',
			1,
			'npm error You cannot publish over the previously published versions: 4.7.0.\n'
		)
	);
	assert(r.status === 0, `expected exit 0, got ${r.status}\n${r.stdout}${r.stderr}`);
	assert(r.stdout.includes('on npm'), `expected per-package verification\n${r.stdout}`);
});

test('fails when a workspace version is not on npm', () => {
	// Force a mismatch by pointing the wrapper at a bogus package list.
	const listStub = join(workDir, 'fake-list.mjs');
	writeFileSync(listStub, `process.stdout.write('@selvajs/cli\\t99.99.99\\tpackages/cli\\n');\n`);
	const r = spawnSync('node', [wrapper], {
		encoding: 'utf8',
		env: {
			...process.env,
			SELVA_FAKE_CHANGESET_PUBLISH: fakePublisher('unpublished', 1),
			SELVA_FAKE_PACKAGE_LIST: listStub
		}
	});
	assert(r.status !== 0, 'a version npm does not serve must keep the release red');
	assert(
		r.stderr.includes('not on npm'),
		`expected the genuine-failure message, got:\n${r.stderr}`
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
