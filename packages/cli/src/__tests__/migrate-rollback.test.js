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
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	existsSync,
	rmSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrate, BACKUP_PATTERN, NODE_MODULES_STASH } from '../commands/migrate.js';
import { pm2Bin } from '../commands/pm2.js';

// A deployment on the OLD layout, so migrate always finds something to do.
function legacyDeployment() {
	const dir = mkdtempSync(join(tmpdir(), 'selva-migrate-'));
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({
			name: 'legacy',
			version: '0.1.0',
			// Both are dropped, by different mechanisms: @selvajs/platform is a
			// LEGACY_DEPENDENCIES entry, while an unrecognised package goes simply
			// because migrate replaces `dependencies` wholesale.
			dependencies: { '@selvajs/platform': '1.0.0', 'some-operator-addition': '1.0.0' }
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

// Migrate resolves dist-tags through `npm view`; stub it so tests stay offline.
const resolveVersion = () => '4.7.3';

/** Backups migrate wrote for `base`, oldest first (stamps sort chronologically). */
function backupsIn(dir, base) {
	return readdirSync(dir)
		.filter((n) => n.startsWith(base + '.') && BACKUP_PATTERN.test(n))
		.sort();
}

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
			},
			resolveVersion
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
	assert.ok(pkg.dependencies['@selvajs/platform'], 'package.json rolled back');
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
		pm2: () => 0,
		resolveVersion
	});

	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	assert.equal(pkg.dependencies['@selvajs/platform'], undefined, 'legacy dep dropped');
	assert.equal(
		pkg.dependencies['some-operator-addition'],
		undefined,
		'dependencies replaced wholesale'
	);
	assert.ok(pkg.dependencies['@selvajs/selva'], 'runtime added');
	assert.equal(pkg.scripts.start, 'selva start');

	assert.equal(existsSync(join(dir, NODE_MODULES_STASH)), false, 'stash cleaned up on success');
	assert.equal(
		backupsIn(dir, 'package.json').length,
		1,
		'a rollback copy is left for the operator'
	);
});

test('a second migration does not overwrite the first migration backup (#184)', async (t) => {
	// Each run backs up the CURRENT file, so a fixed `package.json.bak` meant the
	// second migration's copy held post-first-migration state — and the original
	// pre-migration config was gone from disk entirely.
	const dir = legacyDeployment();
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const run = () =>
		runMigrate(undefined, {
			dir,
			confirm: approve,
			install: () => {},
			pm2: () => 0,
			resolveVersion
		});

	await run();
	const first = backupsIn(dir, 'package.json');
	assert.equal(first.length, 1);
	const original = readFileSync(join(dir, first[0]), 'utf8');
	assert.match(
		original,
		/some-operator-addition/,
		'the first backup holds the pre-migration config'
	);

	// Re-introduce drift so the second run has something to do — an already-current
	// deployment hits the idempotence guard and never writes a backup at all.
	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	pkg.dependencies['@selvajs/platform'] = '1.0.0';
	writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8');

	// Stamps have one-second resolution, so a same-second second run would reuse
	// the filename. Real migrations are minutes apart; the wait keeps the test
	// honest about what it is asserting.
	await new Promise((r) => setTimeout(r, 1100));
	await run();

	const both = backupsIn(dir, 'package.json');
	assert.equal(both.length, 2, 'each migration keeps its own backup');
	assert.equal(
		readFileSync(join(dir, both[0]), 'utf8'),
		original,
		'the original pre-migration config is still recoverable'
	);
});

test('declining the confirmation changes nothing on disk', async (t) => {
	const dir = legacyDeployment();
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const before = readFileSync(join(dir, 'package.json'), 'utf8');
	await runMigrate(undefined, {
		dir,
		confirm: async () => false,
		install: () => assert.fail('install must not run when the operator declines'),
		pm2: () => assert.fail('pm2 must not run when the operator declines'),
		resolveVersion
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
