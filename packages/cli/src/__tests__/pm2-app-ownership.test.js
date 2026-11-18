// Two installs under one pm2 daemon, both named `selva-compute`.
//
// pm2 finds an app by name alone. An update of the second install stopped and
// started the first one's process; the second kept serving on replaced files, and
// the health check took its answer for the new version.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appName, foreignOwner, requireOwnApp, stillAnswering } from '../commands/pm2.js';

function install(ecosystem) {
	const dir = mkdtempSync(join(tmpdir(), 'selva-install-'));
	if (ecosystem !== undefined) writeFileSync(join(dir, 'ecosystem.config.cjs'), ecosystem);
	return dir;
}

const entry = (name, cwd) => ({ name, pm2_env: { status: 'online', pm_cwd: cwd } });
const same = (path) => path;

test('reads the app name the ecosystem file declares', () => {
	const dir = install(`module.exports = { apps: [{ name: 'selva-test' }] };`);
	try {
		assert.equal(appName(dir), 'selva-test');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('falls back to the scaffold name without a readable ecosystem file', () => {
	const missing = install();
	const broken = install('module.exports = {');
	try {
		assert.equal(appName(missing), 'selva-compute');
		assert.equal(appName(broken), 'selva-compute');
	} finally {
		rmSync(missing, { recursive: true, force: true });
		rmSync(broken, { recursive: true, force: true });
	}
});

test('names the other install when it owns the pm2 app', () => {
	const list = [entry('selva-compute', '/home/selva/selva')];
	assert.equal(
		foreignOwner(list, 'selva-compute', '/home/selva/selva-test', same),
		'/home/selva/selva'
	);
});

test('finds no foreign owner for its own app, an unknown app or a symlinked path', () => {
	const list = [entry('selva-compute', '/home/selva/selva')];
	assert.equal(foreignOwner(list, 'selva-compute', '/home/selva/selva', same), null);
	assert.equal(foreignOwner(list, 'selva-test', '/home/selva/selva-test', same), null);
	const resolve = (path) => (path === '/srv/current' ? '/home/selva/selva' : path);
	assert.equal(foreignOwner(list, 'selva-compute', '/srv/current', resolve), null);
});

test('refuses to act on an app another install owns, and says how to rename', () => {
	const dir = install(`module.exports = { apps: [{ name: 'selva-compute' }] };`);
	try {
		assert.throws(
			() => requireOwnApp(dir, [entry('selva-compute', '/home/selva/selva')]),
			/runs from \/home\/selva\/selva, not from this install.*its own `name`/s
		);
		assert.equal(requireOwnApp(dir, [entry('selva-compute', dir)]), 'selva-compute');
		// No pm2, or a list it could not read: nothing to refuse.
		assert.equal(requireOwnApp(dir, null), 'selva-compute');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a port that goes silent after the stop is stopped', async () => {
	let calls = 0;
	const probe = async () => {
		if (++calls > 2) throw new Error('ECONNREFUSED');
		return { ok: true };
	};
	assert.equal(await stillAnswering({ PORT: '3001' }, 15, probe, 0), false);
	assert.equal(calls, 3);
});

test('a port that keeps answering is not stopped, whatever the status', async () => {
	const probe = async () => ({ ok: false, status: 503 });
	assert.equal(await stillAnswering({ PORT: '3001' }, 3, probe, 0), true);
});
