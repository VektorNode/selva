// `selva migrate` needs a clean install (a legacy lockfile pins the old package
// set across a major bump), but node_modules is also where pm2 lives — and the
// rollback has to restart the app. Deleting it outright left a failed migration
// with a stopped app, no dependency tree, and a silently-swallowed pm2 ENOENT.
//
// These drive the real `runMigrate` against a real directory, with only npm and
// pm2 stubbed. Asserting on the filesystem afterwards is the point: a test that
// re-implemented the rename/restore sequence would still pass if someone
// deleted it from migrate.js.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrate, NODE_MODULES_STASH } from '../commands/migrate.js';
import { pm2Bin } from '../commands/pm2.js';

// A deployment on the OLD layout, so migrate always finds something to do.
function legacyDeployment() {
	const dir = mkdtempSync(join(tmpdir(), 'selva-migrate-'));
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({
			name: 'legacy',
			version: '0.1.0',
			dependencies: { '@selvajs/runtime': '1.0.0', '@selvajs/platform': '1.0.0' }
		}),
		'utf8'
	);
	writeFileSync(join(dir, '.env'), 'ORIGIN=https://example.com\n', 'utf8');
	writeFileSync(join(dir, 'ecosystem.config.cjs'), 'module.exports = {};\n', 'utf8');
	writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');

	// The dependency tree the app is currently running on, pm2 included.
	const binDir = join(dir, 'node_modules', '.bin');
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, process.platform === 'win32' ? 'pm2.cmd' : 'pm2'), '#!/bin/sh\n', {
		mode: 0o755
	});
	writeFileSync(join(dir, 'node_modules', 'MARKER'), 'original tree\n', 'utf8');
	return dir;
}

const approve = async () => true;

test('a failed install restores the dependency tree and restarts the app', async (t) => {
	const dir = legacyDeployment();
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const pm2Calls = [];
	// process.exit terminates the real process, so the code after it never runs.
	// Throwing models that; letting the mock return would let execution fall
	// through into the success path and record a second start.
	const exitCodes = [];
	t.mock.method(process, 'exit', (code) => {
		exitCodes.push(code);
		throw new Error('process.exit');
	});

	await assert.rejects(
		runMigrate(undefined, {
			dir,
			confirm: approve,
			install: () => {
				// pm2 must be unreachable at the moment the install fails — that is
				// what made the old rollback silently fail to restart.
				assert.throws(() => pm2Bin(dir), /pm2 not found/);
				throw new Error('npm install failed (simulated)');
			},
			pm2: (_dir, args) => {
				pm2Calls.push(args.join(' '));
				return 0;
			}
		}),
		/process\.exit/
	);

	assert.deepEqual(exitCodes, [1], 'a failed migration exits non-zero');

	// The tree the app was running on is back, and it is the ORIGINAL one.
	assert.ok(existsSync(join(dir, 'node_modules')), 'node_modules restored');
	assert.equal(readFileSync(join(dir, 'node_modules', 'MARKER'), 'utf8'), 'original tree\n');
	assert.ok(pm2Bin(dir), 'pm2 resolves again, so the app can be restarted');
	assert.equal(existsSync(join(dir, NODE_MODULES_STASH)), false, 'no stash left behind');

	// package.json and the lockfile are back on the pre-migration layout.
	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	assert.ok(pkg.dependencies['@selvajs/runtime'], 'package.json rolled back');
	assert.ok(existsSync(join(dir, 'package-lock.json')), 'lockfile restored');

	// A stopped app is the operator-visible half of this bug: migrate stops
	// selva-compute before mutating, so failing to start it again leaves the
	// deployment down even though every file was restored correctly.
	assert.deepEqual(
		pm2Calls,
		['stop selva-compute', 'start selva-compute --update-env'],
		'the rollback must restart the app it stopped'
	);
});

test('a successful migration rewrites the layout and leaves no stash', async (t) => {
	const dir = legacyDeployment();
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	await runMigrate(undefined, {
		dir,
		confirm: approve,
		// A real npm would recreate node_modules; migrate must not depend on it.
		install: () => {},
		pm2: () => 0
	});

	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	assert.equal(pkg.dependencies['@selvajs/runtime'], undefined, 'legacy dep dropped');
	assert.ok(pkg.dependencies['@selvajs/selva'], 'runtime added');
	assert.equal(pkg.scripts.start, 'selva start');

	assert.equal(existsSync(join(dir, NODE_MODULES_STASH)), false, 'stash cleaned up on success');
	assert.ok(existsSync(join(dir, 'package.json.bak')), 'a rollback copy is left for the operator');
});

test('declining the confirmation changes nothing on disk', async (t) => {
	const dir = legacyDeployment();
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const before = readFileSync(join(dir, 'package.json'), 'utf8');
	await runMigrate(undefined, {
		dir,
		confirm: async () => false,
		install: () => assert.fail('install must not run when the operator declines'),
		pm2: () => assert.fail('pm2 must not run when the operator declines')
	});

	assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
	assert.ok(existsSync(join(dir, 'node_modules', 'MARKER')), 'node_modules untouched');
});

test('pm2Bin refuses to fall back to a global pm2', () => {
	// migrate used to carry its own resolver that silently fell through to a
	// bare `pm2` on PATH — the version-skew source pm2.js exists to prevent.
	const dir = mkdtempSync(join(tmpdir(), 'selva-nopm2-'));
	assert.throws(() => pm2Bin(dir), /pm2 not found/);
	rmSync(dir, { recursive: true, force: true });
});
