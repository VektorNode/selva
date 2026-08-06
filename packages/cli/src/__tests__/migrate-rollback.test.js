// `selva migrate` needs a clean install (a legacy lockfile pins the old package
// set across a major bump), but node_modules is also where pm2 lives — and the
// rollback has to restart the app. Deleting it outright left a failed migration
// with a stopped app, no dependency tree, and a silently-swallowed pm2 ENOENT.
//
// These pin the recovery contract: the tree is restorable, and pm2 resolves
// again once it is restored.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pm2Bin } from '../commands/pm2.js';

function deploymentWithPm2() {
	const dir = mkdtempSync(join(tmpdir(), 'selva-migrate-'));
	const binDir = join(dir, 'node_modules', '.bin');
	mkdirSync(binDir, { recursive: true });
	const bin = join(binDir, process.platform === 'win32' ? 'pm2.cmd' : 'pm2');
	writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	writeFileSync(join(dir, 'package-lock.json'), '{}\n', 'utf8');
	return dir;
}

test('moving node_modules aside keeps it restorable, unlike deleting it', () => {
	const dir = deploymentWithPm2();
	const nodeModules = join(dir, 'node_modules');
	const bak = join(dir, 'node_modules.selva-migrate-bak');

	assert.ok(pm2Bin(dir), 'pm2 resolves before the migration starts');

	// What migrate does before `npm install`.
	renameSync(nodeModules, bak);
	assert.equal(existsSync(nodeModules), false);
	assert.throws(() => pm2Bin(dir), /pm2 not found/, 'pm2 is unavailable mid-migration');

	// What the rollback does when the install fails.
	rmSync(nodeModules, { recursive: true, force: true });
	renameSync(bak, nodeModules);

	assert.ok(pm2Bin(dir), 'pm2 resolves again after rollback, so the app can be restarted');
	assert.equal(existsSync(bak), false, 'the stash is consumed by the restore');

	rmSync(dir, { recursive: true, force: true });
});

test('pm2Bin refuses to fall back to a global pm2', () => {
	// migrate used to carry its own resolver that silently fell through to a
	// bare `pm2` on PATH — the version-skew source pm2.js exists to prevent.
	const dir = mkdtempSync(join(tmpdir(), 'selva-nopm2-'));
	assert.throws(() => pm2Bin(dir), /pm2 not found/);
	rmSync(dir, { recursive: true, force: true });
});
